import fc from 'fast-check';
import { PNG } from 'pngjs';
import { describe, expect, it } from 'vitest';
import { glideMs, glidePoints } from '../tools/demo-capture/cursor.js';
import {
  compareArgs,
  greyBandShare,
  lastFrameArgs,
  mp4Args,
  mp4Filter,
  parseProbe,
  parseSimilarity,
  pngSize,
  probeArgs,
} from '../tools/demo-capture/media.js';
import { VIDEO_FPS, VIDEO_SIZE, VIEW_100, VIEW_125 } from '../tools/demo-capture/plan.js';
import { checkBuiltForBase } from '../tools/demo-capture/serve.js';

// V1b. The pure parts of the recorder: the glide, the ffmpeg and ffprobe arguments and what they print,
// the grey-padding check and the base check on the served page.

describe('glidePoints', () => {
  it('ends exactly on the target and moves only towards it', () => {
    fc.assert(
      fc.property(
        fc.record({ x: fc.integer({ min: 0, max: 1920 }), y: fc.integer({ min: 0, max: 1080 }) }),
        fc.record({ x: fc.integer({ min: 0, max: 1920 }), y: fc.integer({ min: 0, max: 1080 }) }),
        fc.integer({ min: 0, max: 2_000 }),
        (from, to, ms) => {
          const points = glidePoints(from, to, ms);
          expect(points.length).toBe(Math.max(1, Math.round(ms / 16)));
          expect(points[points.length - 1]).toEqual(to);
          // Ease-in-out never overshoots: each step is no further from the target than the last.
          let last = Math.hypot(to.x - from.x, to.y - from.y);
          for (const point of points) {
            const distance = Math.hypot(to.x - point.x, to.y - point.y);
            expect(distance).toBeLessThanOrEqual(last + 1e-9);
            last = distance;
          }
        },
      ),
    );
  });

  it('takes 450 ms for a short move and at most 900 ms across the screen', () => {
    expect(glideMs({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(450);
    expect(glideMs({ x: 0, y: 0 }, { x: 1920, y: 1080 })).toBe(900);
  });
});

describe('the ffmpeg arguments', () => {
  it('make an H.264 MP4 in limited range, tagged BT.709, at a constant 30 fps, with no audio', () => {
    const args = mp4Args('in.webm', 'out.mp4');
    expect(args.slice(-1)).toEqual(['out.mp4']);
    expect(args).toEqual(expect.arrayContaining(['-c:v', 'libx264', '-an', '-movflags', '+faststart', '-fps_mode', 'cfr']));
    const after = (flag: string) => args[args.indexOf(flag) + 1];
    expect(after('-i')).toBe('in.webm');
    expect(after('-r')).toBe(String(VIDEO_FPS));
    expect(after('-color_range')).toBe('tv');
    expect(after('-colorspace')).toBe('bt709');
    expect(after('-vf')).toBe(mp4Filter());
  });

  it('scale the 125% frames up to 1920x1080 with Lanczos, and leave full-size frames unscaled', () => {
    expect(mp4Filter(VIDEO_SIZE)).toBe(
      'scale=1920:1080:flags=lanczos:in_range=auto:out_range=tv:in_color_matrix=auto:out_color_matrix=bt709,format=yuv420p',
    );
    expect(mp4Filter()).not.toContain('lanczos');
    expect(mp4Args('a', 'b', VIDEO_SIZE)).toContain(mp4Filter(VIDEO_SIZE));
  });

  it('take the last frame, compare at 1080p, and probe with frame counts', () => {
    expect(lastFrameArgs('c.webm', 'l.png')).toEqual(expect.arrayContaining(['-sseof', '-0.3', '-i', 'c.webm', '-frames:v', '1', 'l.png']));
    const compare = compareArgs('a.png', 'b.png', VIDEO_SIZE);
    expect(compare[compare.indexOf('-lavfi') + 1]).toContain('[0:v]scale=1920:1080:flags=lanczos');
    expect(probeArgs('c.mp4')).toEqual(['-v', 'error', '-count_frames', '-print_format', 'json', '-show_streams', '-show_format', 'c.mp4']);
  });
});

describe('the views', () => {
  it('records the 125% layout at its CSS size and the 100% layout at 1080p', () => {
    expect(VIEW_125).toMatchObject({ viewport: { width: 1536, height: 864 }, deviceScaleFactor: 1.25, frame: { width: 1536, height: 864 } });
    expect(VIEW_100).toMatchObject({ viewport: VIDEO_SIZE, deviceScaleFactor: 1, frame: VIDEO_SIZE });
  });
});

describe('parseProbe', () => {
  it('reads the first video stream and the file format', () => {
    const json = JSON.stringify({
      streams: [
        { codec_type: 'audio', codec_name: 'opus' },
        { codec_type: 'video', codec_name: 'vp9', width: 1536, height: 864, pix_fmt: 'yuv420p', color_space: 'bt470bg', color_range: 'pc', avg_frame_rate: '30/1', nb_read_frames: '309' },
      ],
      format: { duration: '10.300000', bit_rate: '1762103', size: '2268708' },
    });
    expect(parseProbe(json)).toEqual({
      codec: 'vp9', width: 1536, height: 864, pixFmt: 'yuv420p', colorSpace: 'bt470bg', colorRange: 'pc',
      fps: 30, frames: 309, durationS: 10.3, bitRate: 1762103, sizeBytes: 2268708,
    });
  });

  it('says so when there is no video', () => {
    expect(() => parseProbe(JSON.stringify({ streams: [] }))).toThrow('no video stream');
  });
});

describe('parseSimilarity', () => {
  it('reads SSIM All and PSNR average from ffmpeg stderr', () => {
    const stderr = [
      '[Parsed_ssim_4 @ 0x1] SSIM R:0.93 G:0.94 B:0.93 All:0.935319 (11.891)',
      '[Parsed_psnr_5 @ 0x2] PSNR r:26.8 g:27.0 b:26.9 average:26.901756 min:24.1 max:30.2',
    ].join('\n');
    expect(parseSimilarity(stderr)).toEqual({ ssim: 0.935319, psnrDb: 26.901756 });
    expect(parseSimilarity('SSIM All:1.000000 (inf)\nPSNR average:inf min:inf').psnrDb).toBe(Number.POSITIVE_INFINITY);
    expect(() => parseSimilarity('nothing')).toThrow('no SSIM or PSNR');
  });
});

function png(width: number, height: number, colour: (x: number, y: number) => [number, number, number]): Buffer {
  const image = new PNG({ width, height });
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b] = colour(x, y);
      const i = (y * width + x) * 4;
      image.data[i] = r;
      image.data[i + 1] = g;
      image.data[i + 2] = b;
      image.data[i + 3] = 255;
    }
  }
  return PNG.sync.write(image);
}

describe('greyBandShare and pngSize', () => {
  it('is 1 when the band is Playwright grey and 0 when it is the site ground', () => {
    const padded = png(20, 10, (x, y) => (x < 16 && y < 8 ? [20, 20, 20] : [128, 128, 128]));
    expect(greyBandShare(padded, { width: 16, height: 8 })).toBe(1);
    const full = png(20, 10, () => [20, 20, 20]);
    expect(greyBandShare(full, { width: 16, height: 8 })).toBe(0);
    expect(greyBandShare(png(20, 10, () => [133, 124, 130]), { width: 16, height: 8 })).toBe(1);
  });

  it('reads the size from the PNG header and refuses other files', () => {
    expect(pngSize(png(20, 10, () => [0, 0, 0]))).toEqual({ width: 20, height: 10 });
    expect(() => pngSize(Buffer.from('not a png at all, really'))).toThrow('not a PNG');
  });
});

describe('checkBuiltForBase', () => {
  it('accepts the /facsimortis/ build and refuses the default build', () => {
    expect(() => checkBuiltForBase('<script type="module" crossorigin src="/facsimortis/assets/index-x.js"></script>')).not.toThrow();
    expect(() => checkBuiltForBase('<script type="module" crossorigin src="./assets/index-x.js"></script>')).toThrow(
      'not the /facsimortis/ build',
    );
  });
});

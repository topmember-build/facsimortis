import { execFile } from 'node:child_process';
import { PNG } from 'pngjs';
import { VIDEO_FPS } from './plan.js';

/**
 * ffmpeg and ffprobe, run as separate programs from PATH (no shell, arguments as a list), and the pure
 * parts that read what they print. Paths given here come from OutDir (paths.ts), so they are inside demo-out/.
 */

export interface RunResult {
  stdout: string;
  stderr: string;
}

export function run(command: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    execFile(command, [...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const code = (error as NodeJS.ErrnoException).code;
        const why = code === 'ENOENT' ? `${command} was not found on PATH` : `${command} failed: ${stderr.trim().split('\n').slice(-3).join(' ') || error.message}`;
        reject(new Error(why));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

/**
 * Pure. The ffmpeg filter for the MP4 copy: scaled to `size` with Lanczos when given, converted to limited range
 * and BT.709 (the WebM is full range and BT.601 because Chrome's frames are JPEG), then 4:2:0.
 */
export function mp4Filter(size?: { width: number; height: number }): string {
  const scale = size ? `${size.width}:${size.height}:flags=lanczos:` : '';
  return `scale=${scale}in_range=auto:out_range=tv:in_color_matrix=auto:out_color_matrix=bt709,format=yuv420p`;
}

/**
 * Pure. ffmpeg arguments for the H.264 MP4 copy that Clipchamp reads everywhere: yuv420p in limited range, tagged
 * BT.709, constant frame rate, faststart. `size` scales the picture (used when the WebM is smaller than 1080p).
 */
export function mp4Args(input: string, output: string, size?: { width: number; height: number }): string[] {
  return [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', input,
    '-an',
    '-vf', mp4Filter(size),
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
    '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
    '-r', String(VIDEO_FPS), '-fps_mode', 'cfr',
    '-movflags', '+faststart',
    output,
  ];
}

/** Pure. ffmpeg arguments that save the last frame of a clip as PNG (the clip ends on a still frame). */
export function lastFrameArgs(input: string, output: string): string[] {
  return ['-hide_banner', '-loglevel', 'error', '-y', '-sseof', '-0.3', '-i', input, '-frames:v', '1', '-update', '1', output];
}

/**
 * Pure. ffmpeg arguments that compare a video frame `a` with the lossless reference `b`: SSIM and PSNR, printed on
 * stderr. `a` is first scaled to `size` with Lanczos (a no-op when it is that size already), so a smaller frame is
 * judged the way a viewer sees it after scaling.
 */
export function compareArgs(a: string, b: string, size: { width: number; height: number }): string[] {
  return [
    '-hide_banner', '-i', a, '-i', b,
    '-lavfi',
    `[0:v]scale=${size.width}:${size.height}:flags=lanczos,format=rgb24,split[a0][a1];[1:v]format=rgb24,split[b0][b1];[a0][b0]ssim;[a1][b1]psnr`,
    '-f', 'null', '-',
  ];
}

export const probeArgs = (input: string): string[] => [
  '-v', 'error', '-count_frames', '-print_format', 'json', '-show_streams', '-show_format', input,
];

export interface ProbeResult {
  codec: string;
  width: number;
  height: number;
  pixFmt: string;
  colorSpace: string;
  /** "tv" (limited) or "pc" (full). */
  colorRange: string;
  /** Frames per second from the stream's average frame rate. */
  fps: number;
  frames: number;
  durationS: number;
  /** Bits per second over the whole file. */
  bitRate: number;
  sizeBytes: number;
}

function ratio(text: string | undefined): number {
  const [num, den] = String(text ?? '0/1').split('/').map(Number);
  return den ? (num ?? 0) / den : 0;
}

/** Pure. The numbers that matter from ffprobe's JSON output, for the first video stream. */
export function parseProbe(json: string): ProbeResult {
  const data = JSON.parse(json) as {
    streams?: Record<string, string | number | undefined>[];
    format?: Record<string, string | number | undefined>;
  };
  const video = data.streams?.find((stream) => stream['codec_type'] === 'video');
  if (!video) throw new Error('ffprobe found no video stream');
  const format = data.format ?? {};
  return {
    codec: String(video['codec_name'] ?? 'unknown'),
    width: Number(video['width']),
    height: Number(video['height']),
    pixFmt: String(video['pix_fmt'] ?? 'unknown'),
    colorSpace: String(video['color_space'] ?? 'not tagged'),
    colorRange: String(video['color_range'] ?? 'not tagged'),
    fps: Math.round(ratio(String(video['avg_frame_rate'])) * 100) / 100,
    frames: Number(video['nb_read_frames'] ?? video['nb_frames'] ?? 0),
    durationS: Math.round(Number(format['duration'] ?? video['duration'] ?? 0) * 1000) / 1000,
    bitRate: Number(format['bit_rate'] ?? 0),
    sizeBytes: Number(format['size'] ?? 0),
  };
}

export interface Similarity {
  ssim: number;
  psnrDb: number;
}

/** Pure. SSIM ("All:") and PSNR ("average:") from ffmpeg's stderr. PSNR "inf" means the images are identical. */
export function parseSimilarity(stderr: string): Similarity {
  const ssim = /SSIM .*All:([0-9.]+)/.exec(stderr);
  const psnr = /PSNR .*average:([0-9.]+|inf)/.exec(stderr);
  if (!ssim || !psnr) throw new Error('ffmpeg printed no SSIM or PSNR line');
  return { ssim: Number(ssim[1]), psnrDb: psnr[1] === 'inf' ? Number.POSITIVE_INFINITY : Number(psnr[1]) };
}

/**
 * Pure. The share of pixels in the band outside `inner` (right and bottom) that are Playwright's grey padding
 * (#808080, give or take `tolerance` per channel after video compression). If Chrome sent frames smaller than
 * the video, the band is all padding and the share is near 1. The site's own colours are far from that grey.
 */
export function greyBandShare(png: Buffer, inner: { width: number; height: number }, tolerance = 10): number {
  const image = PNG.sync.read(png);
  let band = 0;
  let grey = 0;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (x < inner.width && y < inner.height) continue;
      band++;
      const i = (y * image.width + x) * 4;
      const near = (v: number | undefined) => Math.abs((v ?? 0) - 128) <= tolerance;
      if (near(image.data[i]) && near(image.data[i + 1]) && near(image.data[i + 2])) grey++;
    }
  }
  return band === 0 ? 0 : grey / band;
}

/** Pure. Width and height from a PNG header. */
export function pngSize(png: Buffer): { width: number; height: number } {
  if (png.length < 24 || png.toString('latin1', 1, 4) !== 'PNG') throw new Error('not a PNG file');
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

# Recorded OCR fixtures

`fax-0002.ocr.json` is the recorded output (an `OcrResult`) of the local Tesseract.js adapter
(page segmentation mode 3, `tessdata_fast` English model) on the synthetic fax
`fixtures/faxes/L2/fax-0002.png`.

- Source PNG SHA256: `8E8B8504DA535A1ACC1DD01E8F8CF5690E7A6D03EFC7C5C263FDD208C73506F3`
- Recorded: 2026-11-12

Everything on the page is synthetic data. The file is used as a regression fixture so tests can
check the extractor on real OCR output (word order, skew, box shapes) without running OCR.
Do not edit it by hand; re-record it if the adapter or the PNG changes.

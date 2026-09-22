# Free English ⇄ Hindi Document Translator

A GitHub Pages friendly, browser-only translator.

## No API key / no paid API

The app processes files in the browser. It uses:
- PDF.js for PDF parsing/rendering
- Tesseract.js for OCR
- Transformers.js for local in-browser translation
- Xenova OPUS-MT English→Hindi / Hindi→English models

There is no OpenAI key and no application backend.

## GitHub Pages

1. Create a new GitHub repository.
2. Upload all files in this folder to the repository root.
3. Settings → Pages → Deploy from branch → `main` → `/ (root)`.
4. Open the generated GitHub Pages URL.

## Supported input

- PDF
- JPG
- JPEG

## Long documents

PDF pages are processed one at a time. Text is split into chunks before translation to reduce memory use. The browser keeps the translation model in its cache after the first download.

For very large documents, a modern desktop browser with adequate RAM is recommended.

## Important limitation

This is machine translation, not a human translation. Official, legal, financial or safety-critical documents should be reviewed before use.

The OPUS-MT browser model can be large on the first run. After it is cached, later runs are faster.

## License / third-party notices

This project uses third-party libraries/models loaded from their public CDNs/repositories. Check their respective licenses before redistributing a modified bundle.

from typing import List
import fitz  # PyMuPDF
from app.models.document import PageResult, OcrElement, BoundingBox
from app.ocr.base import OcrProvider


def extract_pages_from_pdf(
    pdf_bytes: bytes,
    ocr_provider: OcrProvider | None = None,
) -> List[PageResult]:
    """
    Extract page-level text and bounding boxes from a PDF.

    Strategy:
    - Use PyMuPDF's native text extraction for pages that contain selectable
      text (typed documents, digital PDFs).
    - If a page has no selectable text, render it to an image and run OCR via
      the provided OcrProvider (scanned documents).
    - If no OCR provider is given for a scanned page, that page is returned
      with an empty elements list and it is the caller's responsibility to
      supply an OcrProvider for scanned content.

    Coordinate system: pixels from top-left, matching the original PDF point
    dimensions (1 pt = 1 unit; no DPI scaling applied to the text path).
    """
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise ValueError(f"Cannot open PDF: {exc}") from exc

    if len(doc) == 0:
        raise ValueError("PDF has no pages.")

    pages: List[PageResult] = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        width = page.rect.width
        height = page.rect.height

        elements = _extract_text_elements(page)

        if not elements and ocr_provider is not None:
            elements = _ocr_page(page, ocr_provider, width, height)

        pages.append(
            PageResult(
                pageNumber=page_index + 1,
                width=width,
                height=height,
                elements=elements,
            )
        )

    doc.close()
    return pages


def _extract_text_elements(page: fitz.Page) -> List[OcrElement]:
    """Extract text blocks with bboxes from a selectable-text PDF page."""
    elements: List[OcrElement] = []
    text_dict = page.get_text("dict")
    for block in text_dict.get("blocks", []):
        if block.get("type") != 0:  # 0 = text block
            continue
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "").strip()
                if not text:
                    continue
                x0, y0, x1, y1 = span["bbox"]
                elements.append(
                    OcrElement(
                        text=text,
                        bbox=BoundingBox(
                            x=x0,
                            y=y0,
                            width=x1 - x0,
                            height=y1 - y0,
                        ),
                    )
                )
    return elements


def _ocr_page(
    page: fitz.Page,
    ocr_provider: OcrProvider,
    width: float,
    height: float,
) -> List[OcrElement]:
    """Render a PDF page to an image and run OCR on it."""
    import io
    from PIL import Image

    # 2× scaling for better OCR accuracy
    mat = fitz.Matrix(2, 2)
    pix = page.get_pixmap(matrix=mat)
    img_bytes = pix.tobytes("png")
    image = Image.open(io.BytesIO(img_bytes))

    raw_elements = ocr_provider.extract(image)

    # Scale coordinates back to original PDF point dimensions
    scale_x = width / pix.width
    scale_y = height / pix.height
    scaled: List[OcrElement] = []
    for el in raw_elements:
        scaled.append(
            OcrElement(
                text=el.text,
                bbox=BoundingBox(
                    x=el.bbox.x * scale_x,
                    y=el.bbox.y * scale_y,
                    width=el.bbox.width * scale_x,
                    height=el.bbox.height * scale_y,
                ),
            )
        )
    return scaled

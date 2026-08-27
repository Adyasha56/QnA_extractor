"""
PDF page renderer.

Renders each page of a PDF to a PNG image at a deterministic scale using
PyMuPDF. All image bytes are kept in memory — nothing is written to disk.

Coordinate relationship between the rendered image and PDF points:
    scale_x = pdfWidth  / imageWidth   (e.g. 595.28 / 1190 ≈ 0.500 for A4 at 2×)
    scale_y = pdfHeight / imageHeight  (e.g. 841.89 / 1684 ≈ 0.500 for A4 at 2×)

    pdf_x      = pixel_x      * scale_x
    pdf_y      = pixel_y      * scale_y
    pdf_width  = pixel_width  * scale_x
    pdf_height = pixel_height * scale_y

The default scale of 2.0 matches the existing OCR path in pdf_processor.py
so that Gemini-derived pixel coordinates and Tesseract pixel coordinates can
be converted to PDF points using the same formula.
"""

import base64
import io
from typing import List

import fitz

from app.models.document import RenderedPage

# Must match the Matrix used in pdf_processor._ocr_page so the scale factors
# are consistent across both paths.
DEFAULT_RENDER_SCALE = 2.0


def render_pdf_pages(
    pdf_bytes: bytes,
    scale: float = DEFAULT_RENDER_SCALE,
) -> List[RenderedPage]:
    """
    Render every page of a PDF to PNG and return metadata + base64 image data.

    Args:
        pdf_bytes: Raw PDF file content.
        scale: Uniform scale applied to both axes via fitz.Matrix(scale, scale).
               Default 2.0 gives ~144 DPI for a 72 DPI PDF.

    Returns:
        One RenderedPage per PDF page, in document order.

    Raises:
        ValueError: If the bytes cannot be opened as a PDF or the PDF has no pages.
    """
    try:
        doc = fitz.open(stream=pdf_bytes, filetype="pdf")
    except Exception as exc:
        raise ValueError(f"Cannot open PDF: {exc}") from exc

    if len(doc) == 0:
        raise ValueError("PDF has no pages.")

    mat = fitz.Matrix(scale, scale)
    pages: List[RenderedPage] = []

    for page_index in range(len(doc)):
        page = doc[page_index]
        pdf_width = page.rect.width
        pdf_height = page.rect.height

        pix = page.get_pixmap(matrix=mat)
        png_bytes = pix.tobytes("png")

        pages.append(
            RenderedPage(
                pageNumber=page_index + 1,
                pdfWidth=pdf_width,
                pdfHeight=pdf_height,
                imageWidth=pix.width,
                imageHeight=pix.height,
                imageBase64=base64.b64encode(png_bytes).decode("ascii"),
            )
        )

    doc.close()
    return pages

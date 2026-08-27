from typing import List, Optional, Literal
from pydantic import BaseModel, HttpUrl


class BoundingBox(BaseModel):
    x: float
    y: float
    width: float
    height: float


class OcrElement(BaseModel):
    text: str
    bbox: BoundingBox


class PageResult(BaseModel):
    pageNumber: int
    width: float
    height: float
    elements: List[OcrElement]


class ProcessingResult(BaseModel):
    pages: List[PageResult]


class ProcessRequest(BaseModel):
    url: HttpUrl
    documentType: Optional[Literal["question_paper", "answer_sheet"]] = None


# ─── Page rendering models ────────────────────────────────────────────────────

class RenderedPage(BaseModel):
    """
    A single PDF page rendered to a PNG image at a fixed scale.

    Coordinate contract:
      pdfWidth / pdfHeight  — page dimensions in PDF points (1 pt = 1/72 inch).
      imageWidth / imageHeight — rendered PNG dimensions in pixels.
      scale factor: pdf_coord = pixel_coord * (pdfWidth / imageWidth)
                             = pixel_coord * (pdfHeight / imageHeight)

    imageBase64 — PNG bytes encoded as base64 (standard, no line breaks).
    """
    pageNumber: int
    pdfWidth: float
    pdfHeight: float
    imageWidth: int
    imageHeight: int
    imageBase64: str


class RenderResult(BaseModel):
    pages: List[RenderedPage]


class RenderRequest(BaseModel):
    url: HttpUrl

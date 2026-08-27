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

from fastapi import APIRouter, Depends, HTTPException
from app.models.document import ProcessRequest, ProcessingResult
from app.ocr.base import OcrProvider
from app.ocr.tesseract_provider import TesseractProvider
from app.services.document_service import process_document_url

router = APIRouter()


def get_ocr_provider() -> OcrProvider:
    """
    Dependency that supplies the active OCR provider.
    Override in tests via app.dependency_overrides.
    """
    return TesseractProvider()


@router.post("/process", response_model=ProcessingResult)
async def process_document(
    request: ProcessRequest,
    ocr_provider: OcrProvider = Depends(get_ocr_provider),
) -> ProcessingResult:
    try:
        return await process_document_url(str(request.url), ocr_provider)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

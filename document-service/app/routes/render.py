from fastapi import APIRouter, HTTPException
from app.models.document import RenderRequest, RenderResult
from app.services.document_service import render_document_pages

router = APIRouter()


@router.post("/render-pages", response_model=RenderResult)
async def render_pages(request: RenderRequest) -> RenderResult:
    """
    Download a PDF from the given URL and render each page to a PNG image.

    Returns one RenderedPage per PDF page containing:
    - PDF-point dimensions (pdfWidth, pdfHeight)
    - rendered pixel dimensions (imageWidth, imageHeight)
    - base64-encoded PNG image data (imageBase64)

    The scale factor to convert Gemini pixel coordinates back to PDF points:
        scale = pdfWidth / imageWidth  (same for height)

    Only PDF documents are accepted. Image URLs return 400.
    """
    try:
        return await render_document_pages(str(request.url))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

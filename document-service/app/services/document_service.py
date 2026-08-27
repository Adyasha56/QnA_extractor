import httpx
from app.models.document import ProcessingResult
from app.ocr.base import OcrProvider
from app.processors.pdf_processor import extract_pages_from_pdf
from app.processors.image_processor import extract_from_image

# Content-type → processing strategy
_CONTENT_TYPE_MAP: dict[str, str] = {
    "application/pdf": "pdf",
    "image/jpeg": "image",
    "image/jpg": "image",
    "image/png": "image",
    "image/webp": "image",
    "image/tiff": "image",
    "image/bmp": "image",
}

# URL extension fallback when the server sends a generic content-type
_EXTENSION_MAP: dict[str, str] = {
    ".pdf": "pdf",
    ".jpg": "image",
    ".jpeg": "image",
    ".png": "image",
    ".webp": "image",
    ".tiff": "image",
    ".tif": "image",
    ".bmp": "image",
}

_MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024  # 50 MB hard cap


async def process_document_url(
    url: str,
    ocr_provider: OcrProvider,
) -> ProcessingResult:
    """
    Download a document from a URL and extract page-level text with bboxes.
    Raises ValueError for client-side problems, RuntimeError for server faults.
    """
    content, doc_kind = await _download(url)

    if doc_kind == "pdf":
        pages = extract_pages_from_pdf(content, ocr_provider)
    elif doc_kind == "image":
        pages = extract_from_image(content, ocr_provider)
    else:
        raise ValueError(f"Cannot determine document type for URL: {url}")

    return ProcessingResult(pages=pages)


async def _download(url: str) -> tuple[bytes, str]:
    """
    Fetch the document from a URL with timeout and size guard.
    Returns (raw_bytes, doc_kind).
    """
    try:
        async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
            async with client.stream("GET", url) as response:
                response.raise_for_status()

                content_type = (
                    response.headers.get("content-type", "").split(";")[0].strip().lower()
                )
                doc_kind = _CONTENT_TYPE_MAP.get(content_type)

                chunks: list[bytes] = []
                total = 0
                async for chunk in response.aiter_bytes(chunk_size=65536):
                    total += len(chunk)
                    if total > _MAX_DOWNLOAD_BYTES:
                        raise ValueError(
                            f"Document exceeds maximum size of "
                            f"{_MAX_DOWNLOAD_BYTES // (1024 * 1024)} MB."
                        )
                    chunks.append(chunk)

                content = b"".join(chunks)

    except httpx.HTTPStatusError as exc:
        raise ValueError(
            f"Failed to download document (HTTP {exc.response.status_code}): {url}"
        ) from exc
    except httpx.RequestError as exc:
        raise ValueError(f"Network error downloading document: {exc}") from exc

    # Fall back to URL extension if content-type was unhelpful
    if not doc_kind:
        url_path = url.split("?")[0].lower()
        for ext, kind in _EXTENSION_MAP.items():
            if url_path.endswith(ext):
                doc_kind = kind
                break

    if not doc_kind:
        raise ValueError(
            f"Unsupported document type. Supported: PDF, JPEG, PNG, WebP, TIFF."
        )

    return content, doc_kind

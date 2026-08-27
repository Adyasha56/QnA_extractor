import io
from typing import List
from PIL import Image
from app.models.document import PageResult
from app.ocr.base import OcrProvider


SUPPORTED_FORMATS = {"JPEG", "PNG", "WEBP", "TIFF", "BMP"}


def extract_from_image(
    image_bytes: bytes,
    ocr_provider: OcrProvider,
) -> List[PageResult]:
    """
    Extract text from an image file.

    Returns a single-page result. Page dimensions are the natural pixel
    dimensions of the image. Coordinates in elements are pixel-based.
    """
    try:
        image = Image.open(io.BytesIO(image_bytes))
    except Exception as exc:
        raise ValueError(f"Cannot open image: {exc}") from exc

    fmt = image.format or ""
    if fmt.upper() not in SUPPORTED_FORMATS:
        raise ValueError(
            f"Unsupported image format: {fmt}. "
            f"Supported: {', '.join(sorted(SUPPORTED_FORMATS))}"
        )

    width, height = image.size

    # Ensure RGB for OCR (handles RGBA, palette, etc.)
    if image.mode not in ("RGB", "L"):
        image = image.convert("RGB")

    elements = ocr_provider.extract(image)

    return [
        PageResult(
            pageNumber=1,
            width=float(width),
            height=float(height),
            elements=elements,
        )
    ]

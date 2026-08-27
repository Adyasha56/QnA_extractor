import os
from typing import List
from PIL import Image
from app.ocr.base import OcrProvider
from app.models.document import OcrElement, BoundingBox


class TesseractProvider(OcrProvider):
    """
    OCR provider backed by Tesseract. Requires the Tesseract binary to be
    installed and either on PATH or configured via TESSERACT_CMD env var.

    Install Tesseract:
      - Windows: https://github.com/UB-Mannheim/tesseract/wiki
      - Linux:   apt-get install tesseract-ocr
      - macOS:   brew install tesseract
    """

    def __init__(self) -> None:
        try:
            import pytesseract  # type: ignore

            cmd = os.environ.get("TESSERACT_CMD")
            if cmd:
                pytesseract.pytesseract.tesseract_cmd = cmd
            self._pytesseract = pytesseract
        except ImportError as exc:
            raise RuntimeError("pytesseract is not installed.") from exc

    def extract(self, image: Image.Image) -> List[OcrElement]:
        data = self._pytesseract.image_to_data(
            image, output_type=self._pytesseract.Output.DICT
        )
        elements: List[OcrElement] = []
        for i, text in enumerate(data["text"]):
            if not text or not text.strip():
                continue
            conf = int(data["conf"][i])
            if conf < 0:
                continue
            elements.append(
                OcrElement(
                    text=text.strip(),
                    bbox=BoundingBox(
                        x=float(data["left"][i]),
                        y=float(data["top"][i]),
                        width=float(data["width"][i]),
                        height=float(data["height"][i]),
                    ),
                )
            )
        return elements

from abc import ABC, abstractmethod
from typing import List
from PIL import Image
from app.models.document import OcrElement


class OcrProvider(ABC):
    """
    Abstract OCR provider. Swap the concrete implementation without touching
    any other part of the codebase.
    """

    @abstractmethod
    def extract(self, image: Image.Image) -> List[OcrElement]:
        """
        Extract text elements with bounding boxes from a PIL Image.

        Coordinates must be in pixels relative to the top-left corner of the
        image. Width and height are the dimensions of the text region.
        """
        ...

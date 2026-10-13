"""pytest configuration: make the project root importable so `from src...` works from any working directory."""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import os
from flask import Blueprint, render_template, send_from_directory

pages_bp = Blueprint('pages', __name__)

@pages_bp.get("/static/<path:filename>")
def static_files(filename):
    # Go up one directory to access the top-level 'static' folder
    static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
    return send_from_directory(static_dir, filename)

@pages_bp.get("/")
@pages_bp.get("/chat")
@pages_bp.get("/admin")
@pages_bp.get("/admin/review")
@pages_bp.get("/admin/review/<path:rest>")
@pages_bp.get("/admin/settings")
@pages_bp.get("/cases")
@pages_bp.get("/cases/<path:rest>")
def home():
    return render_template("index.html")

import os
import logging
from flask import Flask

from db import init_db
from routes import register_routes

# Configure basic logging for Azure Log Stream
logging.basicConfig(level=logging.INFO)

# Explicit template folder for Azure App Service reliability
app = Flask(__name__, template_folder="templates")

# Initialize database schema if connection string exists
init_db()

# Register all application routes (pages, api, system)
register_routes(app)

# Seed demo data for MVP verification (no-op if data already exists)
from routes.api import seed_demo_data
with app.app_context():
    seed_demo_data()

# ===============================
# Local Dev Entry Point
# ===============================
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=8000)

#!/bin/bash
set -e

echo "ODBC drivers installed. Starting app..."
exec gunicorn --bind=0.0.0.0:8000 --timeout 600 app:app


# Field Compass - Backend

This directory contains the FastAPI backend for the Field Compass application.

## Setup and Running

### Prerequisites
- Python 3.8+
- Docker (for containerized approach)

### Running Locally (without Docker)

1.  **Create a virtual environment:**
    ```bash
    python -m venv venv
    source venv/bin/activate  # On Windows, use `venv\Scripts\activate`
    ```

2.  **Install dependencies:**
    ```bash
    pip install -r requirements.txt
    ```

3.  **Run the server:**
    The application is located in the `main.py` file inside the current directory (`backend`). To run it with Uvicorn:
    ```bash
    uvicorn main:app --reload
    ```
    The `--reload` flag makes the server restart after code changes.

4.  **Access the API:**
    The API will be available at `http://127.0.0.1:8000`.
    Interactive documentation (Swagger UI) is available at `http://127.0.0.1:8000/docs`.

### Running with Docker

1.  **Build the Docker image:**
    From the `backend` directory, run:
    ```bash
    docker build -t field-compass-backend .
    ```

2.  **Run the Docker container:**
    ```bash
    docker run -d -p 8000:8000 --name field-compass-api field-compass-backend
    ```
    - `-d` runs the container in detached mode.
    - `-p 8000:8000` maps port 8000 of the host to port 8000 in the container.

3.  **Access the API:**
    The API and docs will be available at the same URLs as above: `http://127.0.0.1:8000` and `http://127.0.0.1:8000/docs`.

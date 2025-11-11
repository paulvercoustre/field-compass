# Backend Tests

This directory contains the test suite for the Field Compass backend.

## Running Tests

### Run all tests
```bash
# From project root
make test

# Or from backend directory
cd backend
pytest
```

### Run specific test file
```bash
pytest tests/test_data_merger.py
```

### Run specific test
```bash
pytest tests/test_data_merger.py::TestParseKoboSubmission::test_parse_basic_submission
```

### Run with coverage
```bash
pytest --cov=. --cov-report=html
```

### Run with verbose output
```bash
pytest -v
```

## Test Structure

- `conftest.py`: Pytest configuration and shared fixtures
- `test_data_merger.py`: Tests for data merging and parsing logic
- `test_hfc_engine.py`: Tests for HFC engine, especially status determination
- `test_api_endpoints.py`: Tests for FastAPI endpoints

## Test Database

Tests use an in-memory SQLite database for speed and isolation. Each test gets a fresh database instance.

## Writing New Tests

1. Create a new test file: `test_<module_name>.py`
2. Import pytest and necessary modules
3. Use fixtures from `conftest.py` (e.g., `test_db`, `test_survey_config`)
4. Follow naming convention: `test_<functionality>`

Example:
```python
def test_my_function(test_db, test_survey_config):
    """Test description."""
    # Arrange
    # Act
    # Assert
```



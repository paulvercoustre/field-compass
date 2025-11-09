"""
Pydantic models for API request/response validation.
These models match the frontend TypeScript types.
"""

from datetime import datetime
from enum import Enum
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field, ConfigDict


# ============================================================================
# QA Status Enum
# ============================================================================

class QAStatus(str, Enum):
    """Field Compass QA status values."""
    PENDING_APPROVAL = "PENDING_APPROVAL"  # Passes HFC checks, waiting for approval in Kobo
    FLAGGED = "FLAGGED"  # Has HFC issues that need to be fixed
    APPROVED = "APPROVED"  # Approved in KoboToolbox
    REJECTED = "REJECTED"  # Rejected/Not Approved in KoboToolbox


# ============================================================================
# Quality Issue Models
# ============================================================================

class QualityIssue(BaseModel):
    check: str = Field(..., description="Type of check that flagged this issue")
    field: str = Field(..., description="Field name where issue was found")
    value: Any = Field(..., description="Value that triggered the issue")
    message: str = Field(..., description="Human-readable issue message")


# ============================================================================
# Submission Models
# ============================================================================

class Submission(BaseModel):
    # Use validation_alias to allow underscore-prefixed field names from Kobo
    id: int = Field(..., description="KoboToolbox submission ID (stable primary key)", validation_alias="_id", serialization_alias="_id")
    uuid: str = Field(..., description="KoboToolbox UUID", validation_alias="_uuid", serialization_alias="_uuid")
    submission_time: datetime = Field(..., description="Original submission timestamp", validation_alias="_submission_time", serialization_alias="_submission_time")
    end: datetime = Field(..., description="End timestamp (used for edit detection)")
    submission_data: Dict[str, Any] = Field(..., description="Complete submission data as JSON")
    is_edited: bool = Field(default=False, description="Whether submission has been edited")
    data_quality_issues: List[QualityIssue] = Field(
        default_factory=list, description="Array of quality issues found"
    )
    qa_status: str = Field(..., description="Current QA status")
    kobo_validation_status: Optional[str] = Field(None, description="KoboToolbox validation status (Approved, Not Approved, On Hold, etc.)")
    kobo_edit_url: Optional[str] = Field(None, description="URL to view/edit this submission in KoboToolbox")

    model_config = ConfigDict(
        populate_by_name=True,
        json_schema_extra={
            "example": {
                "_id": 1001,
                "_uuid": "uuid-1001-v2",
                "_submission_time": "2023-10-26T10:00:00Z",
                "end": "2023-10-27T14:35:10Z",
                "submission_data": {
                    "name": "John Doe",
                    "age": 99,
                    "income": 150000
                },
                "is_edited": True,
                "data_quality_issues": [
                    {
                        "check": "Outlier",
                        "field": "age",
                        "value": 99,
                        "message": "Age 99 is above the 95th percentile (90)."
                    }
                ],
                "qa_status": "HFC_FLAGGED"
            }
        }
    )


# ============================================================================
# History Models
# ============================================================================

class JsonPatch(BaseModel):
    op: str = Field(..., description="Operation: add, remove, or replace")
    path: str = Field(..., description="JSON path to the field")
    value: Optional[Any] = Field(None, description="New value (for add/replace)")
    from_: Optional[str] = Field(None, alias="from", description="Source path (for move operations)")


class SubmissionHistory(BaseModel):
    history_id: int = Field(..., description="History record ID")
    kobo_id: int = Field(..., description="Reference to submission _id")
    timestamp: datetime = Field(..., description="When the edit occurred")
    deprecated_uuid: str = Field(..., description="Previous UUID before edit")
    data_delta: List[JsonPatch] = Field(..., description="JSON patch array showing changes")

    class Config:
        json_schema_extra = {
            "example": {
                "history_id": 201,
                "kobo_id": 1001,
                "timestamp": "2023-10-27T14:35:10Z",
                "deprecated_uuid": "uuid-1001-v1",
                "data_delta": [
                    {
                        "op": "replace",
                        "path": "/age",
                        "value": 99
                    }
                ]
            }
        }


# ============================================================================
# Progress Tracking Models
# ============================================================================

class OverallProgress(BaseModel):
    conducted: int
    target: int
    progress: float


class ProgressByDistrict(BaseModel):
    district: str
    conducted: int
    target: int
    progress: float


class ProgressByLivelihood(BaseModel):
    livelihood: str
    conducted: int
    target: int
    progress: float


class DetailedProgress(BaseModel):
    district: str
    livelihood: str
    target: int
    conducted: int
    progress: float


class ProgressData(BaseModel):
    overall: OverallProgress
    byDistrict: List[ProgressByDistrict]
    byLivelihood: List[ProgressByLivelihood]
    detailed: List[DetailedProgress]


# ============================================================================
# Enumerator Performance Models
# ============================================================================

class EnumeratorCollectionStats(BaseModel):
    id: str
    needsReview: int
    validated: int
    total: int
    percentValidated: str
    percentNeedsReview: str


class EnumeratorQualityStats(BaseModel):
    id: str
    avgActiveTime: int
    avgTotalTime: int
    avgDkRate: str
    avgIssuesPerSurvey: float


class PerformanceData(BaseModel):
    collection: List[EnumeratorCollectionStats]
    quality: List[EnumeratorQualityStats]


# ============================================================================
# API Response Models
# ============================================================================

class BaseResponse(BaseModel):
    success: bool
    message: str
    data: Optional[Dict[str, Any]] = None


class SubmissionListResponse(BaseModel):
    submissions: List[Submission]
    total: int
    page: int
    page_size: int


class ErrorResponse(BaseModel):
    detail: str

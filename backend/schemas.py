from pydantic import BaseModel
from typing import Union, Literal

# 1. Define a model for each state in our contract

class ProgressState(BaseModel):
    status: Literal["progress"]
    processed: int
    total: int

class CompletedState(BaseModel):
    status: Literal["completed"]

class FailedState(BaseModel):
    status: Literal["failed"]
    error: str

class NoMatchesState(BaseModel):
    status: Literal["no_matches"]

# 2. Create a Union type that represents any possible valid status
WorkflowStatus = Union[ProgressState, CompletedState, FailedState, NoMatchesState]
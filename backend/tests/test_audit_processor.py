"""
Tests for audit log processor.
"""

import pytest
import os
import csv
import tempfile
import shutil
from pathlib import Path

from etl.audit_processor import (
    process_audit_log,
    download_audit_log,
    download_and_process_audit,
    get_audit_dir
)


class TestAuditProcessor:
    """Tests for audit log processing."""
    
    def test_process_audit_log_with_question_events(self):
        """Test processing audit log with question events."""
        # Create a temporary audit log CSV
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=['event', 'start', 'end', 'node'])
            writer.writeheader()
            # Add question events (times in milliseconds)
            writer.writerow({'event': 'form start', 'start': '1000', 'end': '1000', 'node': ''})
            writer.writerow({'event': 'question', 'start': '2000', 'end': '62000', 'node': 'q1'})  # 60 seconds = 1 minute
            writer.writerow({'event': 'question', 'start': '63000', 'end': '123000', 'node': 'q2'})  # 60 seconds = 1 minute
            writer.writerow({'event': 'question', 'start': '124000', 'end': '184000', 'node': 'q3'})  # 60 seconds = 1 minute
            writer.writerow({'event': 'form finalize', 'start': '185000', 'end': '185000', 'node': ''})
            temp_file = f.name
        
        try:
            uuid = 'test-uuid-123'
            metrics = process_audit_log(temp_file, uuid)
            
            assert metrics is not None
            # Total active time: 60 + 60 + 60 = 180 seconds = 3 minutes
            assert metrics['active_interview_time'] == 3
            assert metrics['jump_count'] == 0
            assert metrics['total_duration'] is not None
        finally:
            os.unlink(temp_file)
    
    def test_process_audit_log_with_jumps(self):
        """Test processing audit log with jump events."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=['event', 'start', 'end', 'node'])
            writer.writeheader()
            writer.writerow({'event': 'question', 'start': '1000', 'end': '5000', 'node': 'q1'})
            writer.writerow({'event': 'jump', 'start': '6000', 'end': '6000', 'node': ''})
            writer.writerow({'event': 'question', 'start': '7000', 'end': '10000', 'node': 'q2'})
            temp_file = f.name
        
        try:
            metrics = process_audit_log(temp_file, 'test-uuid')
            
            assert metrics is not None
            assert metrics['jump_count'] == 1
        finally:
            os.unlink(temp_file)
    
    def test_process_audit_log_calculates_median_question_time(self):
        """Test that median question time is calculated correctly."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=['event', 'start', 'end', 'node'])
            writer.writeheader()
            # Question durations: 1s, 2s, 3s, 4s, 5s (median = 3s)
            writer.writerow({'event': 'question', 'start': '1000', 'end': '2000', 'node': 'q1'})  # 1s
            writer.writerow({'event': 'question', 'start': '3000', 'end': '5000', 'node': 'q2'})  # 2s
            writer.writerow({'event': 'question', 'start': '6000', 'end': '9000', 'node': 'q3'})  # 3s
            writer.writerow({'event': 'question', 'start': '10000', 'end': '14000', 'node': 'q4'})  # 4s
            writer.writerow({'event': 'question', 'start': '15000', 'end': '20000', 'node': 'q5'})  # 5s
            temp_file = f.name
        
        try:
            metrics = process_audit_log(temp_file, 'test-uuid')
            
            assert metrics is not None
            assert metrics['median_question_time'] == 3  # Median of [1,2,3,4,5] = 3
        finally:
            os.unlink(temp_file)
    
    def test_process_audit_log_handles_missing_file(self):
        """Test that processing handles missing file gracefully."""
        metrics = process_audit_log('/nonexistent/file.csv', 'test-uuid')
        assert metrics is None
    
    def test_process_audit_log_handles_empty_file(self):
        """Test that processing handles empty file gracefully."""
        with tempfile.NamedTemporaryFile(mode='w', suffix='.csv', delete=False) as f:
            writer = csv.DictWriter(f, fieldnames=['event', 'start', 'end'])
            writer.writeheader()
            temp_file = f.name
        
        try:
            metrics = process_audit_log(temp_file, 'test-uuid')
            assert metrics is None
        finally:
            os.unlink(temp_file)
    
    def test_get_audit_dir_creates_directory(self):
        """Test that get_audit_dir creates the directory if it doesn't exist."""
        with tempfile.TemporaryDirectory() as temp_dir:
            # Set environment variable to use temp directory
            original_dir = os.getenv('AUDIT_DIR')
            try:
                test_audit_dir = os.path.join(temp_dir, 'test_audits')
                os.environ['AUDIT_DIR'] = test_audit_dir
                
                # Should create directory
                audit_dir = get_audit_dir()
                
                assert os.path.exists(audit_dir)
                assert audit_dir == test_audit_dir
            finally:
                if original_dir:
                    os.environ['AUDIT_DIR'] = original_dir
                elif 'AUDIT_DIR' in os.environ:
                    del os.environ['AUDIT_DIR']


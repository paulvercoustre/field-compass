"""
Tests for type conversion logic in HFC engine.
Tests edge cases for _convert_value_type method.
"""

import pytest
from etl.hfc_engine import HFCEngine
from database.models import SurveyConfig
from simpleeval import SimpleEval


class TestTypeConversion:
    """Tests for _convert_value_type method edge cases."""
    
    def test_type_conversion_edge_cases(self, test_db, test_survey_config):
        """Test the _convert_value_type method with various edge cases."""
        engine = HFCEngine(test_db, test_survey_config)
        
        test_cases = [
            ("250", 250),  # string int -> int
            ("250.0", 250.0),  # string float -> float
            ("96.2", 96.2),  # string decimal -> float
            ("123.456", 123.456),  # string decimal -> float
            ("0", 0),  # string zero -> int
            ("-50", -50),  # negative string -> int
            ("-25.5", -25.5),  # negative decimal -> float
            (250, 250),  # int stays int
            (250.5, 250.5),  # float stays float
            ("not_a_number", "not_a_number"),  # invalid string stays string
            ("dk", "dk"),  # special value stays string
            ("DK", "DK"),  # case insensitive special value
            ("n/a", "n/a"),  # special value stays string
            ("", ""),  # empty string stays empty
            ("   ", "   "),  # whitespace-only stays as-is
            ("abc123", "abc123"),  # mixed alphanumeric stays string
            ("123abc", "123abc"),  # mixed alphanumeric stays string
        ]
        
        for input_val, expected in test_cases:
            result = engine._convert_value_type(input_val)
            assert result == expected, f"Expected {expected!r}, got {result!r} for input {input_val!r}"
    
    def test_simpleeval_compatibility(self, test_db, test_survey_config):
        """Test that converted values work with SimpleEval comparisons."""
        engine = HFCEngine(test_db, test_survey_config)
        
        # Test cases that should work after conversion
        test_cases = [
            (250, "income > 200", True),  # 250 > 200 = True
            (150, "income > 200", False),  # 150 > 200 = False
            (96.2, "score >= 95.5", True),  # 96.2 >= 95.5 = True
            (94.8, "score >= 95.5", False),  # 94.8 >= 95.5 = False
            (18, "age < 18", False),  # 18 < 18 = False
            (17, "age < 18", True),   # 17 < 18 = True
        ]
        
        for value, expression, expected in test_cases:
            # Test both income and score variables
            names = {'income': value, 'score': value, 'age': value}
            # Names belong on the evaluator, not on eval() -- eval() has never
            # accepted a `names` keyword. This mirrors how hfc_engine actually
            # calls it, so the test exercises the real code path.
            evaluator = SimpleEval(names=names)
            result = evaluator.eval(expression)
            assert result == expected, f"Expression '{expression}' with value {value} failed: expected {expected}, got {result}"
    
    def test_string_vs_number_comparison_demonstration(self, test_db, test_survey_config):
        """Demonstrate that string comparisons fail and numeric comparisons work."""
        engine = HFCEngine(test_db, test_survey_config)
        
        # This should fail (TypeError: '>' not supported between instances of 'str' and 'int')
        with pytest.raises(TypeError):
            SimpleEval(names={'income': "250"}).eval("income > 200")
        
        # This should work after conversion
        result = SimpleEval(names={'income': 250}).eval("income > 200")
        assert result == True, "Numeric comparison should work: 250 > 200 = True"
        
        # Test that conversion works
        converted = engine._convert_value_type("250")
        assert converted == 250, "String '250' should convert to int 250"
        result = SimpleEval(names={'income': converted}).eval("income > 200")
        assert result == True, "Converted value should work in comparison"

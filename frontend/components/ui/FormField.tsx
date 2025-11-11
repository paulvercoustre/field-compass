import React from 'react';
import ErrorMessage from './ErrorMessage';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string | null;
  children: React.ReactNode;
  helpText?: string;
  className?: string;
}

const FormField: React.FC<FormFieldProps> = ({
  label,
  htmlFor,
  required = false,
  error,
  children,
  helpText,
  className = '',
}) => {
  const fieldId = htmlFor || `field-${label.toLowerCase().replace(/\s+/g, '-')}`;

  return (
    <div className={`flex flex-col ${className}`}>
      <label
        htmlFor={fieldId}
        className="mb-1 text-sm font-medium text-gray-400"
      >
        {label}
        {required && <span className="text-red-400 ml-1" aria-label="required">*</span>}
      </label>
      {helpText && (
        <p className="text-xs text-gray-500 mb-1">{helpText}</p>
      )}
      <div className={error ? 'has-error' : ''}>
        {React.isValidElement(children) && React.cloneElement(children as React.ReactElement<any>, {
          id: fieldId,
          'aria-invalid': error ? 'true' : 'false',
          'aria-describedby': error ? `${fieldId}-error` : undefined,
          className: `${(children as React.ReactElement<any>).props.className || ''} ${
            error ? 'border-red-500 focus:border-red-500 focus:ring-red-500' : ''
          }`.trim(),
        })}
      </div>
      <ErrorMessage error={error} id={`${fieldId}-error`} />
    </div>
  );
};

export default FormField;


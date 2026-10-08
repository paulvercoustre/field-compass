import React from 'react';
import { AnswerText, formTextParts } from '../../utils/formText';

/** Form text with its references filled and its bold and italic kept (utils/formText.ts). */
const FormText: React.FC<{ text: string; answer?: AnswerText }> = ({ text, answer }) => (
  <>
    {formTextParts(text, answer).map((part, index) =>
      part.bold ? (
        <strong key={index} className="font-semibold">
          {part.text}
        </strong>
      ) : part.italic ? (
        <em key={index}>{part.text}</em>
      ) : (
        <React.Fragment key={index}>{part.text}</React.Fragment>
      )
    )}
  </>
);

export default FormText;

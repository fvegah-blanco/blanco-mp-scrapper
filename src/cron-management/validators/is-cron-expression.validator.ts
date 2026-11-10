import {
  registerDecorator,
  type ValidationOptions,
  type ValidationArguments,
} from 'class-validator';
import { validateCronExpression } from 'cron';

export function IsCronExpression(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isCronExpression',
      target: object.constructor,
      propertyName,
      options: {
        message: ({ value }: ValidationArguments) =>
          `"${String(value)}" is not a valid cron expression`,
        ...validationOptions,
      },
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const { valid } = validateCronExpression(value);
          return valid;
        },
      },
    });
  };
}

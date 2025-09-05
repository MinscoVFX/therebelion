// scaffolds/fun-launch/src/lib/react-form-shim.ts
import * as ReactForm from '@tanstack/react-form';

// Export untyped bindings so callers don't need 10 generics
export const useForm = (ReactForm as any).useForm as any;
export const Field = (ReactForm as any).Field as any;
export const Form = (ReactForm as any).Form as any;
export default ReactForm;

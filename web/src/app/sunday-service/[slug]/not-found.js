import { ServiceNotFound } from '@/components/services/servicePage';

// /sunday-service/<a slug no service has> - said kindly, with the way back.
export default function SundayNotFound() {
  return <ServiceNotFound kind="sunday" />;
}

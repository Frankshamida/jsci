import { ServiceNotFound } from '@/components/services/servicePage';

// /midweek/<a slug no service has> - said kindly, with the way back.
export default function MidweekNotFound() {
  return <ServiceNotFound kind="midweek" />;
}

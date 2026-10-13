import 'server-only';
import { pausedDeliveryProvider } from './paused-delivery';
export const linkedinDeliveryProvider = () => pausedDeliveryProvider('linkedin');

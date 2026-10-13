import 'server-only';
import { pausedDeliveryProvider } from './paused-delivery';
export const whatsappDeliveryProvider = () => pausedDeliveryProvider('whatsapp');

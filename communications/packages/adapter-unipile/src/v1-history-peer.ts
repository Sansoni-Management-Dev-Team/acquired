import type { CanonicalIdentity } from '../../contracts/src';
import { plain, opaque } from './v1-read-guard';
/** Corroborates an exact authenticated account-scoped GET /users/{original provider ID}.
 * WhatsApp's documented PN JID encodes the phone; opaque LID never does. Names are not aliases. */
export function projectHistoryPeer(profile: unknown, providerId: string, channel: 'whatsapp' | 'linkedin'): CanonicalIdentity | null {
    if (!plain(profile) || !opaque(providerId) || profile.object !== 'UserProfile' || profile.is_self === true)
        return null;
    if (channel === 'whatsapp') {
        if (profile.provider !== 'WHATSAPP' || profile.id !== providerId)
            return null;
        const match = /^([1-9]\d{6,14})@s\.whatsapp\.net$/.exec(providerId);
        if (!match)
            return null;
        const value = `+${match[1]}`;
        if (profile.phone_number !== undefined && profile.phone_number !== value)
            return null;
        return { kind: 'phone', value };
    }
    if (profile.provider !== 'LINKEDIN' || profile.provider_id !== providerId)
        return null;
    let url: URL;
    try {
        if (typeof profile.public_profile_url === 'string')
            url = new URL(profile.public_profile_url);
        else if (typeof profile.public_identifier === 'string' && /^[A-Za-z0-9_-]{1,200}$/.test(profile.public_identifier))
            url = new URL(`https://www.linkedin.com/in/${profile.public_identifier}/`);
        else
            return null;
    }
    catch {
        return null;
    }
    if (url.protocol !== 'https:' || !['linkedin.com', 'www.linkedin.com'].includes(url.hostname) || url.search || url.hash || url.username || url.password || url.port || !/^\/in\/[^/]+\/?$/.test(url.pathname))
        return null;
    return { kind: 'linkedin_profile', value: `https://www.linkedin.com${url.pathname.replace(/\/$/, '')}` };
}

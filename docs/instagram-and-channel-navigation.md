# Channel navigation and Instagram connections

Updated 2026-11-02 for the existing Space Penguin Studio deployment.

## Product decisions

- The left navigation lists tasks. One persistent channel picker sits at the top right on desktop and mobile.
- The picker controls list scope. A saved item retains its own publishing channel when opened from all channels or another list scope.
- New content and ZIP imports expose a channel field at the beginning of the form. With all channels selected, the form starts without a publishing channel and asks for it before saving.
- Stored tokens are not presented as a fresh successful connection. Account checks report identity/publishing permission separately from Cloudinary readiness.
- Credentials stay on the server. The private Sites gateway retains its existing prohibition on connection mutations and OAuth redirects.

## UI references

Verified GitHub displays on 2026-11-02: Postiz about 40.6k stars; Mixpost about 3.9k stars. Counts are approximate and change over time.

- https://github.com/gitroomhq/postiz-app
- https://docs.postiz.com/general/composer/overview — visible target channels and per-platform preview.
- https://docs.postiz.com/general/channels/manage — preselected channel when starting from an account, reconnect state.
- https://github.com/inovector/mixpost
- https://docs.mixpost.app/services/social/instagram/ — dedicated account connection management.

The top-right global picker is a user-requested design choice, not a claim about Postiz's layout. These references inform interaction patterns; their source code was not copied.

## Meta API compatibility

The current Meta app reports that new apps use Unified Login. Official documentation was read in the authenticated Meta browser because the web retrieval service could not read the new documentation route.

- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/get-started (updated 2026-10-27)
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/authentication
- https://developers.facebook.com/documentation/instagram-platform/instagram-api-with-unified-login/permissions

Unified Login uses the Meta app ID/secret and Facebook Login for Business config ID. It uses `graph.facebook.com` and discovers Instagram accounts through `me/assigned_instagram_accounts`, because `/me` identifies the system user. A saved account's explicit auth mode selects the API host for account checks, containers, status, publishing and permalinks. Old destinations without an auth-mode reference continue to use Instagram Login and `graph.instagram.com`.

OAuth starts only from an authenticated, CSRF-protected operator request. The callback validates a short-lived session-bound state, consumes it before exchanging the code, and checks the expected channel username before saving anything. Provider errors are mapped to fixed callback reasons. Expiry is saved only when the provider supplies a usable lifetime; Unified tokens are not assumed to expire in 60 days.

## Expected account mapping

| Channel | Expected username |
| --- | --- |
| 우주펭귄상회 | spacepenguin.co |
| HighScoop | highscoop.official |
| 알리고당 | alligodang.official |
| fryday | fryday.official.kr |

Handles alone never establish API authorization. On 2026-11-02 the Meta app showed all four tester invitations as pending. Live credential exchange and publication were not performed as implementation tests.

## Approval and delivery reliability

The production review found an active approval with zero destination deliveries. The generic item approval path previously accepted an empty destination list, while the publishing inbox queried delivery rows only. The scheduler therefore had nothing to send, and the approval disappeared from the inbox. Its success text also said that a worker would publish it regardless of the actual runtime configuration.

The corrected path checks active channel/destinations, credential presence, actual publishing mode, global stop, daily limit, Instagram API version and image hosting before accepting an approval. Instagram approvals additionally check account identity and publishing API access without creating media. Caption validation applies to the selected delivery platforms. The saved approval snapshot still preserves the submitted captions and accessibility text.

The item detail now exposes safe publication readiness and a dedicated delivery tab. `/publication-orphans` is a read-only diagnostic endpoint for historical active approvals without delivery rows; it leaves the existing `/deliveries` contract unchanged and never creates, cancels or retries a delivery. Existing orphan approvals require a deliberate new approval after their prerequisites are fixed.

The inbox shows older unfinished records in its default list view. Pending deliveries refresh every five seconds. Dry runs, delayed starts, errors, uncertain outcomes and successful posts have distinct messages. A successful approval immediately opens its delivery history and wakes the existing inline worker when enabled. The persisted queue and atomic worker claims remain responsible for delivery.

The review also reproduced a blank screen when a long-open tab requested an old JavaScript chunk after a deployment. A route-level error boundary now preserves navigation and offers an explicit reload instead of silently clearing the app or reloading unsaved work.

Verification covers rejected approvals with zero destinations or missing keys, a valid approval remaining unsent before its schedule and reaching a mocked publisher after its schedule, read-only orphan diagnostics, dedicated status navigation, runtime messages, and mobile publishing-inbox layout. Production account authentication and an actual Instagram upload remain separate checks; automated tests do not post to a real account.

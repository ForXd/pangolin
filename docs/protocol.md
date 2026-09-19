# Pangolin v2 wire protocol

All integers are unsigned, network byte order. Both peers must use v2.

| Offset | Bytes | Field |
| --- | --- | --- |
| 0 | 1 | Message type |
| 1 | 1 | Channel ID, 0–255 |
| 2 | 4 | Body byte length, at most 65536 |
| 6 | length | Body |

| Type | Name | Body | Direction |
| --- | --- | --- | --- |
| 0 | PORT | 4-byte port, ID must be 0 | Client requests; server acknowledges actual bound port |
| 1 | DATA | 1–65536 bytes | Both |
| 2 | CLOSE | Empty | Both; abort / final close acknowledgement |
| 3 | OPEN | Empty | Server → client; immediately connect to target |
| 4 | END | Empty | Both; graceful end of that direction |

Only one PORT request and acknowledgement is allowed per transport. Request port 0 asks for an ephemeral listener. No acknowledgement is sent if binding fails. A client becomes ready only after receiving the acknowledgement. There is no independent version-negotiation message, authentication, or encryption.

The server allocates channel IDs. OPEN precedes channel data, including for server-first protocols. END maps to socket.end(), leaving the readable half available. DATA after END and duplicate END are malformed. Once a socket closes, CLOSE is sent and its ID is retained until the peer's CLOSE arrives. Receiving CLOSE flushes queued destination data first if END was received, otherwise aborts the socket, and acknowledges only if no CLOSE was already sent; simultaneous close therefore terminates without a reply loop. Rejected channels are remembered until CLOSE acknowledgement so their in-flight data cannot tear down unrelated channels.

The parser assembles a fixed-size header before validating type, length and ID constraints. It allocates only the validated body and supports arbitrary TCP fragmentation and coalescing with linear copying cost. Invalid messages close the offending transport and all its streams. Unknown DATA/END is rejected; an unknown CLOSE is ignored.

Transport backpressure pauses channel sources. A blocked destination pauses the transport until all blocked destinations drain or close. This bounds buffering at stream high-water marks plus data already delivered by Node. Multiplexing entails head-of-line blocking: a stalled destination can delay every channel on its transport. Limits apply separately at each endpoint; the server also caps transport count and PORT handshake duration.

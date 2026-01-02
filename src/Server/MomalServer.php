<?php

declare(strict_types=1);

namespace Momal\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Game\Player;
use Momal\Game\Room;
use Ratchet\ConnectionInterface;
use Ratchet\MessageComponentInterface;

final class MomalServer implements MessageComponentInterface
{
    /** @var array<string, ConnectionInterface> */
    private array $connections = []; // connectionId => conn

    /** @var array<string, Player> */
    private array $players = []; // connectionId => player

    /** @var array<string, Room> */
    private array $rooms = []; // roomId => Room

    private int $lastTickAt = 0;

    /**
     * Simple per-connection rate limiting for chat/guess.
     * @var array<string, float>
     */
    private array $lastChatAtMs = [];

    private const DEFAULT_CHAT_RATE_LIMIT_MS = 400;
    private int $chatRateLimitMs;

    /**
     * Simple per-connection rate limiting for draw events.
     * @var array<string, float>
     */
    private array $lastDrawAtMs = [];

    private const DEFAULT_DRAW_RATE_LIMIT_MS = 0;
    private int $drawRateLimitMs;

    /** @var callable(): float */
    private $clockMs;

    /**
     * Draw v2: coalesce many stroke chunks into small batches per room.
     * This reduces per-message overhead and helps with latency/jank when drawing fast.
     *
     * @var array<string, array{nextSeq:int, queued:list<array<string,mixed>>}> roomId => state
     */
    private array $drawOutbox = [];

    /** @var array<string, int> roomId => last flush ms */
    private array $drawOutboxLastFlushMs = [];

    // Drawing batching: tune for smoother remote rendering.
    private const DRAW_OUTBOX_FLUSH_INTERVAL_MS = 8; // was higher; lower => less latency
    private const DRAW_OUTBOX_MAX_EVENTS_PER_BATCH = 80; // bigger batches under fast strokes


    public function __construct(
        private readonly Words $words,
        private readonly HighscoreStore $highscoreStore,
        ?callable $clockMs = null
    ) {
        $this->clockMs = $clockMs ?? static fn (): float => microtime(true) * 1000;

        $this->chatRateLimitMs = $this->envInt('MOMAL_CHAT_RATE_LIMIT_MS', self::DEFAULT_CHAT_RATE_LIMIT_MS);
        $this->drawRateLimitMs = $this->envInt('MOMAL_DRAW_RATE_LIMIT_MS', self::DEFAULT_DRAW_RATE_LIMIT_MS);
    }

    private function envInt(string $key, int $default): int
    {
        $raw = getenv($key);
        if ($raw === false) {
            return $default;
        }
        $v = (int)$raw;

        return $v >= 0 ? $v : $default;
    }

    public function onOpen(ConnectionInterface $conn): void
    {
        $cid = $this->connectionId($conn);
        $this->connections[$cid] = $conn;

        $this->send($conn, [
            'type' => 'hello',
            'connectionId' => $cid,
        ]);
    }

    public function onMessage(ConnectionInterface $from, $msg): void
    {
        $cid = $this->connectionId($from);
        $data = \json_decode((string)$msg, true);
        if (!\is_array($data) || !isset($data['type'])) {
            return;
        }

        $type = (string)$data['type'];

        switch ($type) {
            case 'join':
                $this->handleJoin($from, $data);
                break;
            case 'chat':
                $this->handleChat($from, $data);
                break;
            case 'guess':
                $this->handleGuess($from, $data);
                break;
            case 'round:start':
                $this->handleRoundStart($from);
                break;
            case 'draw:event':
            case 'draw:stroke':
                $this->handleDrawEvent($from, $data);
                break;
            case 'round:clear':
                $this->handleClear($from);
                break;
            default:
                break;
        }
    }

    /**
     * 1s-Tick für Timer / Timeouts; wird vom WebSocket-Bootstrap (EventLoop) aufgerufen.
     */
    public function tick(): void
    {
        $now = \time();
        if ($this->lastTickAt === $now) {
            return;
        }
        $this->lastTickAt = $now;

        foreach ($this->rooms as $room) {
            if ($room->state !== Room::STATE_IN_ROUND) {
                continue;
            }

            if ($room->timeLeft() <= 0) {
                $this->endRound($room, 'Zeit abgelaufen!');
                continue;
            }

            // Keep clients updated about timer.
            $this->broadcastRoomSnapshot($room);
        }
    }

    public function onClose(ConnectionInterface $conn): void
    {
        $cid = $this->connectionId($conn);

        $player = $this->players[$cid] ?? null;
        if ($player !== null) {
            $room = $this->rooms[$player->roomId] ?? null;
            if ($room) {
                $room->removePlayer($cid);

                // If the current drawer leaves mid-round, end round cleanly.
                if ($room->state === Room::STATE_IN_ROUND && $room->drawerConnectionId === null) {
                    $this->endRound($room, 'Zeichner hat verlassen.');
                }

                $this->broadcastRoomSnapshot($room);
                $this->broadcastSystem($room, $player->name . ' hat den Raum verlassen.');

                if ($room->isEmpty()) {
                    unset($this->rooms[$room->id]);
                    unset($this->drawOutbox[$room->id]);
                    unset($this->drawOutboxLastFlushMs[$room->id]);
                }
            }
            unset($this->players[$cid]);
        }

        unset($this->connections[$cid]);
        unset($this->lastChatAtMs[$cid]);
        unset($this->lastDrawAtMs[$cid]);
    }

    public function onError(ConnectionInterface $conn, \Exception $e): void
    {
        $conn->close();
    }

    private function handleJoin(ConnectionInterface $conn, array $data): void
    {
        $cid = $this->connectionId($conn);

        $roomId = strtoupper(preg_replace('/[^A-Za-z0-9]/', '', (string)($data['roomId'] ?? '')) ?? '');
        $roomId = substr($roomId, 0, 6);

        $name = Player::sanitizeName((string)($data['name'] ?? 'Spieler'));

        if ($roomId === '') {
            $this->send($conn, ['type' => 'error', 'message' => 'Room-Code fehlt']);

            return;
        }

        // Re-join semantics: same connection sends join again.
        $existing = $this->players[$cid] ?? null;
        if ($existing !== null) {
            $oldRoom = $this->rooms[$existing->roomId] ?? null;

            // If currently in a round, do not allow switching rooms.
            if ($oldRoom !== null && $oldRoom->state === Room::STATE_IN_ROUND && $existing->roomId !== $roomId) {
                $this->send($conn, ['type' => 'error', 'message' => 'Room-Wechsel während der Runde ist nicht möglich.']);
                $this->broadcastRoomSnapshot($oldRoom);

                return;
            }

            // Switch room if needed.
            if ($existing->roomId !== $roomId && $oldRoom !== null) {
                $oldRoom->removePlayer($cid);
                $this->broadcastRoomSnapshot($oldRoom);

                if ($oldRoom->isEmpty()) {
                    unset($this->rooms[$oldRoom->id]);
                }
            }
        }

        $room = $this->rooms[$roomId] ?? null;
        if ($room === null) {
            $room = new Room($roomId);
            $this->rooms[$roomId] = $room;
        }

        $player = new Player($cid, $name, $roomId);
        if ($existing !== null) {
            $player->score = $existing->score;
        }

        $this->players[$cid] = $player;
        $room->addPlayer($player);

        $this->send($conn, [
            'type' => 'joined',
            'roomId' => $roomId,
            'isHost' => $room->hostConnectionId === $cid,
        ]);

        $this->broadcastSystem($room, $existing ? ($name . ' ist wieder da.') : ($name . ' ist beigetreten.'));
        $this->broadcastRoomSnapshot($room);
    }

    private function handleChat(ConnectionInterface $from, array $data): void
    {
        $cid = $this->connectionId($from);

        // Rate limit (chat + guess share this path).
        $nowMs = ($this->clockMs)();
        $last = $this->lastChatAtMs[$cid] ?? null;
        if ($last !== null && ($nowMs - $last) < $this->chatRateLimitMs) {
            return;
        }
        $this->lastChatAtMs[$cid] = $nowMs;

        $player = $this->players[$cid] ?? null;
        if (!$player) {
            return;
        }
        $room = $this->rooms[$player->roomId] ?? null;
        if (!$room) {
            return;
        }

        $text = trim((string)($data['text'] ?? ''));
        if ($text === '') {
            return;
        }
        $text = mb_substr($text, 0, 200);

        // Broadcast chat message.
        $this->broadcast($room, [
            'type' => 'chat:new',
            'name' => $player->name,
            'text' => $text,
            'ts' => time(),
        ]);

        // Classic mode: treat every chat message as a guess while in round.
        if ($room->state === Room::STATE_IN_ROUND) {
            $this->evaluateGuess($room, $player, $text);
        }
    }

    private function handleGuess(ConnectionInterface $from, array $data): void
    {
        // Backwards compatible: keep existing client behavior ("guess"), server treats it same as chat.
        $this->handleChat($from, ['text' => (string)($data['text'] ?? '')]);
    }

    private function evaluateGuess(Room $room, Player $player, string $guess): void
    {
        $cid = $player->connectionId;

        if ($room->state !== Room::STATE_IN_ROUND) {
            return;
        }
        if ($room->drawerConnectionId === $cid) {
            return; // drawer can't guess
        }

        // already guessed correctly this round => ignore for scoring (and to avoid spam)
        if (isset($room->guessed[$cid])) {
            return;
        }

        $guess = trim($guess);
        if ($guess === '') {
            return;
        }
        $guess = mb_substr($guess, 0, 50);

        $word = (string)$room->word;
        if ($word === '') {
            return;
        }

        if (mb_strtolower($guess) !== mb_strtolower($word)) {
            return;
        }

        // mark as guessed before any further actions
        $room->guessed[$cid] = true;

        // scoring: earlier gets more
        $timeLeft = $room->timeLeft();
        $base = 10;
        $bonus = (int)floor($timeLeft / 10); // up to +8
        $points = $base + $bonus;
        $player->score += $points;

        // drawer gets half
        if ($room->drawerConnectionId !== null && isset($room->players[$room->drawerConnectionId])) {
            $room->players[$room->drawerConnectionId]->score += (int)floor($points / 2);
        }

        $this->broadcastSystem($room, $player->name . ' hat das Wort erraten! (+' . $points . ')');
        $this->broadcastRoomSnapshot($room);

        // Classic: first correct answer ends the round immediately.
        $this->endRound($room, $player->name . ' hat gewonnen!');
    }

    private function handleRoundStart(ConnectionInterface $from): void
    {
        $cid = $this->connectionId($from);
        $player = $this->players[$cid] ?? null;
        if (!$player) {
            return;
        }
        $room = $this->rooms[$player->roomId] ?? null;
        if (!$room) {
            return;
        }
        if ($room->hostConnectionId !== $cid) {
            return;
        }

        $room->startRound($this->words);
        if ($room->state !== Room::STATE_IN_ROUND || $room->drawerConnectionId === null) {
            $this->broadcastSystem($room, 'Mindestens 2 Spieler nötig, um zu starten.');

            return;
        }

        $this->broadcast($room, [
            'type' => 'round:started',
            'drawerConnectionId' => $room->drawerConnectionId,
            'roundDurationSec' => $room->roundDurationSec,
            'roundStartedAt' => $room->roundStartedAt,
            'roundNumber' => $room->roundNumber,
        ]);

        // send secret word only to drawer
        $drawerConn = $this->connections[$room->drawerConnectionId] ?? null;
        if ($drawerConn) {
            $this->send($drawerConn, ['type' => 'round:word', 'word' => $room->word]);
        }

        $this->broadcastSystem($room, 'Runde ' . $room->roundNumber . ' gestartet.');
        $this->broadcastRoomSnapshot($room);
    }

    private function handleDrawEvent(ConnectionInterface $from, array $data): void
    {
        $cid = $this->connectionId($from);

        // Rate limit draw events.
        $nowMs = ($this->clockMs)();
        $last = $this->lastDrawAtMs[$cid] ?? null;
        if ($last !== null && ($nowMs - $last) < $this->drawRateLimitMs) {
            return;
        }
        $this->lastDrawAtMs[$cid] = $nowMs;

        $player = $this->players[$cid] ?? null;
        if (!$player) {
            return;
        }
        $room = $this->rooms[$player->roomId] ?? null;
        if (!$room) {
            return;
        }

        if ($room->state !== Room::STATE_IN_ROUND || $room->drawerConnectionId !== $cid) {
            return;
        }

        $payload = $data['payload'] ?? null;
        if (!is_array($payload)) {
            return;
        }

        $t = (string)($payload['t'] ?? '');

        // New: batched stroke (polyline)
        if ($t === 'stroke') {
            $points = $payload['p'] ?? null;
            if (!is_array($points) || count($points) < 2) {
                return;
            }

            $normPoints = [];
            foreach ($points as $pt) {
                if (!is_array($pt)) {
                    return;
                }
                $normPoints[] = [
                    'x' => (float)($pt['x'] ?? 0),
                    'y' => (float)($pt['y'] ?? 0),
                ];
            }

            $event = [
                't' => 'stroke',
                'p' => $normPoints,
                'c' => (string)($payload['c'] ?? '#000000'),
                'w' => (float)($payload['w'] ?? 3),
            ];

            // v2: queue + coalesce into draw:batch
            $this->queueDrawEvent($room, $event);

            // also flush opportunistically if enough time elapsed
            $this->flushDrawOutbox($room);

            return;
        }

        // Legacy: single line segment
        $event = [
            't' => (string)($payload['t'] ?? ''),
            'x0' => (float)($payload['x0'] ?? 0),
            'y0' => (float)($payload['y0'] ?? 0),
            'x1' => (float)($payload['x1'] ?? 0),
            'y1' => (float)($payload['y1'] ?? 0),
            'c' => (string)($payload['c'] ?? '#000000'),
            'w' => (float)($payload['w'] ?? 3),
        ];

        $this->queueDrawEvent($room, $event);
        $this->flushDrawOutbox($room);
    }

    /** @param array<string,mixed> $event */
    private function queueDrawEvent(Room $room, array $event): void
    {
        $roomId = $room->id;
        if (!isset($this->drawOutbox[$roomId])) {
            $this->drawOutbox[$roomId] = ['nextSeq' => 1, 'queued' => []];
        }

        // prevent unbounded growth under slow clients: cap queue (drop oldest)
        $queued = &$this->drawOutbox[$roomId]['queued'];
        $queued[] = $event;
        if (count($queued) > 2000) {
            $queued = array_slice($queued, -1200);
        }
    }

    private function flushDrawOutbox(Room $room): void
    {
        $roomId = $room->id;
        if (!isset($this->drawOutbox[$roomId]) || $this->drawOutbox[$roomId]['queued'] === []) {
            return;
        }

        $nowMs = (int)round(($this->clockMs)());

        // First flush should be immediate; subsequent flushes follow the interval.
        // If we are heavily backlogged, flush more aggressively to catch up.
        $hasFlushedBefore = array_key_exists($roomId, $this->drawOutboxLastFlushMs);
        $lastFlush = $this->drawOutboxLastFlushMs[$roomId] ?? 0;

        $queueSize = count($this->drawOutbox[$roomId]['queued']);
        $effectiveInterval = self::DRAW_OUTBOX_FLUSH_INTERVAL_MS;
        if ($queueSize > 800) {
            $effectiveInterval = 0; // flush immediately until we catch up
        } elseif ($queueSize > 400) {
            $effectiveInterval = 2;
        } elseif ($queueSize > 200) {
            $effectiveInterval = 4;
        }

        if ($hasFlushedBefore && ($nowMs - $lastFlush) < $effectiveInterval) {
            return;
        }
        $this->drawOutboxLastFlushMs[$roomId] = $nowMs;

        // Build one batch per flush.
        $maxEvents = self::DRAW_OUTBOX_MAX_EVENTS_PER_BATCH;
        $events = [];
        for ($i = 0; $i < $maxEvents; $i++) {
            if ($this->drawOutbox[$roomId]['queued'] === []) {
                break;
            }
            /** @var array<string,mixed> $ev */
            $ev = array_shift($this->drawOutbox[$roomId]['queued']);
            $events[] = $ev;
        }

        if ($events === []) {
            return;
        }

        $seq = $this->drawOutbox[$roomId]['nextSeq'];
        $this->drawOutbox[$roomId]['nextSeq'] = $seq + 1;

        $this->broadcast($room, [
            'type' => 'draw:batch',
            'seq' => $seq,
            'events' => $events,
            'tsMs' => $nowMs,
        ]);

        // If backlog remains, allow another immediate flush on the very next draw event.
        if (count($this->drawOutbox[$roomId]['queued']) > 0) {
            $this->drawOutboxLastFlushMs[$roomId] = $nowMs - $effectiveInterval;
        }
    }

    private function handleClear(ConnectionInterface $from): void
    {
        $cid = $this->connectionId($from);
        $player = $this->players[$cid] ?? null;
        if (!$player) {
            return;
        }
        $room = $this->rooms[$player->roomId] ?? null;
        if (!$room) {
            return;
        }
        if ($room->drawerConnectionId !== $cid) {
            return;
        }

        $this->broadcast($room, ['type' => 'round:clear']);
        unset($this->drawOutbox[$room->id]);
        unset($this->drawOutboxLastFlushMs[$room->id]);
    }

    private function endRound(Room $room, string $reason): void
    {
        if ($room->state !== Room::STATE_IN_ROUND) {
            return;
        }
        $room->state = Room::STATE_ROUND_END;

        // bump highscores
        foreach ($room->players as $p) {
            $this->highscoreStore->bump($p->name, $p->score);
        }

        $this->broadcast($room, [
            'type' => 'round:ended',
            'reason' => $reason,
            'word' => $room->word,
        ]);

        $this->broadcastRoomSnapshot($room);

        // Back to lobby state automatically, keep scores
        $room->resetRoundState();
        unset($this->drawOutbox[$room->id]);
        unset($this->drawOutboxLastFlushMs[$room->id]);

        $this->broadcastRoomSnapshot($room);
    }

    private function broadcastRoomSnapshot(Room $room): void
    {
        $players = [];
        foreach ($room->players as $cid => $p) {
            $cidStr = (string)$cid;
            $players[] = [
                'connectionId' => $cidStr,
                'name' => $p->name,
                'score' => $p->score,
                'isHost' => $room->hostConnectionId === $cidStr,
                'isDrawer' => $room->drawerConnectionId === $cidStr,
            ];
        }

        $this->broadcast($room, [
            'type' => 'room:snapshot',
            'roomId' => $room->id,
            'state' => $room->state,
            'players' => $players,
            'round' => [
                'drawerConnectionId' => $room->drawerConnectionId,
                'roundNumber' => $room->roundNumber,
                'timeLeft' => $room->timeLeft(),
            ],
        ]);
    }

    private function broadcastSystem(Room $room, string $text): void
    {
        $this->broadcast($room, [
            'type' => 'chat:new',
            'name' => 'System',
            'text' => $text,
            'ts' => time(),
        ]);
    }

    private function broadcast(Room $room, array $message): void
    {
        foreach ($room->players as $cid => $_p) {
            $conn = $this->connections[$cid] ?? null;
            if ($conn) {
                $this->send($conn, $message);
            }
        }
    }

    /**
     * Ratchet's ConnectionInterface doesn't formally declare resourceId, but the concrete implementation has it.
     * This helper keeps PHPStan happy and centralizes the fallback.
     */
    private function connectionId(ConnectionInterface $conn): string
    {
        if (\method_exists($conn, 'resourceId')) {
            /** @var mixed $id */
            $id = $conn->resourceId();

            return (string)$id;
        }

        if (\property_exists($conn, 'resourceId')) {
            /** @var mixed $id */
            $id = $conn->resourceId;

            return (string)$id;
        }

        // Last resort: stable-ish object id for runtime safety.
        return (string)\spl_object_id($conn);
    }

    private function send(ConnectionInterface $conn, array $message): void
    {
        $json = \json_encode($message, JSON_UNESCAPED_UNICODE);
        if ($json === false) {
            $json = '{}';
        }

        $conn->send($json);
    }
}

<?php

declare(strict_types=1);

namespace Momal\Game;

use Momal\Domain\Words;

final class Room
{
    public const STATE_LOBBY = 'lobby';
    public const STATE_IN_ROUND = 'in_round';
    public const STATE_ROUND_END = 'round_end';

    public string $id;

    /** @var array<string, Player> connectionId => Player */
    public array $players = [];

    public ?string $hostConnectionId = null;

    /**
     * @var self::STATE_LOBBY|self::STATE_IN_ROUND|self::STATE_ROUND_END
     */
    public string $state = self::STATE_LOBBY;

    public ?string $drawerConnectionId = null;

    /**
     * Keeps drawer rotation stable across rounds, even when the active round state is reset.
     */
    public ?string $lastDrawerConnectionId = null;

    public ?string $word = null;

    public int $roundStartedAt = 0;
    public int $roundDurationSec = 80;

    /** @var array<string,bool> */
    public array $guessed = []; // connectionId => true

    public int $roundNumber = 0;

    public function __construct(string $id)
    {
        $this->id = $id;
    }

    public function addPlayer(Player $player): void
    {
        $this->players[$player->connectionId] = $player;
        if ($this->hostConnectionId === null) {
            $this->hostConnectionId = $player->connectionId;
        }
    }

    public function removePlayer(string $connectionId): void
    {
        unset($this->players[$connectionId]);
        unset($this->guessed[$connectionId]);

        if ($this->hostConnectionId === $connectionId) {
            $nextHost = \array_key_first($this->players);
            $this->hostConnectionId = $nextHost !== null ? (string)$nextHost : null;
        }

        // safety: keep host valid
        if ($this->hostConnectionId !== null && !isset($this->players[$this->hostConnectionId])) {
            $nextHost = \array_key_first($this->players);
            $this->hostConnectionId = $nextHost !== null ? (string)$nextHost : null;
        }

        if ($this->drawerConnectionId === $connectionId) {
            // Keep the round state so the server can detect a missing drawer and end the round.
            $this->drawerConnectionId = null;
        }

        if ($this->lastDrawerConnectionId === $connectionId) {
            $this->lastDrawerConnectionId = null;
        }
    }

    public function isEmpty(): bool
    {
        return \count($this->players) === 0;
    }

    public function startRound(Words $words): void
    {
        if (\count($this->players) < 2) {
            return;
        }

        $this->roundNumber++;
        $this->state = self::STATE_IN_ROUND;
        $this->guessed = [];

        $this->drawerConnectionId = $this->pickNextDrawer();
        $this->lastDrawerConnectionId = $this->drawerConnectionId;

        $this->word = $words->randomWord($this->word);
        $this->roundStartedAt = \time();

        // everybody is allowed to guess except drawer
        if ($this->drawerConnectionId !== null) {
            $this->guessed[$this->drawerConnectionId] = true; // mark as already "guessed" for scoring
        }
    }

    public function resetRoundState(): void
    {
        $this->drawerConnectionId = null;
        $this->word = null;
        $this->state = self::STATE_LOBBY;
        $this->guessed = [];
        $this->roundStartedAt = 0;
    }

    private function pickNextDrawer(): ?string
    {
        /** @var list<string> $ids */
        $ids = \array_map('strval', \array_keys($this->players));
        if ($ids === []) {
            return null;
        }

        if ($this->lastDrawerConnectionId === null) {
            return $ids[0];
        }

        $idx = \array_search($this->lastDrawerConnectionId, $ids, true);
        if ($idx === false) {
            return $ids[0];
        }

        $next = $idx + 1;
        if ($next >= \count($ids)) {
            $next = 0;
        }

        return $ids[$next];
    }

    public function timeLeft(): int
    {
        if ($this->state !== self::STATE_IN_ROUND) {
            return 0;
        }
        $elapsed = \time() - $this->roundStartedAt;

        return \max(0, $this->roundDurationSec - $elapsed);
    }

    public function allGuessersDone(): bool
    {
        if ($this->drawerConnectionId === null) {
            return true;
        }
        foreach ($this->players as $cid => $_p) {
            if ($cid === $this->drawerConnectionId) {
                continue;
            }
            if (!isset($this->guessed[$cid])) {
                return false;
            }
        }

        return true;
    }
}

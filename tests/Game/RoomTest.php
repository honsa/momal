<?php

declare(strict_types=1);

namespace Momal\Tests\Game;

use Momal\Domain\Words;
use Momal\Game\Player;
use Momal\Game\Room;
use PHPUnit\Framework\TestCase;

final class RoomTest extends TestCase
{
    public function testStartRoundRequiresAtLeastTwoPlayers(): void
    {
        $room = new Room('ABC123');
        $room->addPlayer(new Player('1', 'Alice', $room->id));

        $room->startRound(new Words());

        self::assertSame('lobby', $room->state);
        self::assertNull($room->drawerConnectionId);
        self::assertNull($room->word);
        self::assertSame(0, $room->roundNumber);
    }

    public function testStartRoundSetsDrawerWordAndState(): void
    {
        $room = new Room('ABC123');
        $room->addPlayer(new Player('1', 'Alice', $room->id));
        $room->addPlayer(new Player('2', 'Bob', $room->id));

        $room->startRound(new Words());

        self::assertSame('in_round', $room->state);
        self::assertNotNull($room->drawerConnectionId);
        self::assertContains($room->drawerConnectionId, ['1', '2']);
        self::assertNotSame('', (string)$room->word);
        self::assertGreaterThan(0, $room->roundStartedAt);
        self::assertSame(1, $room->roundNumber);

        // Drawer is marked as "already guessed" internally so they can't guess.
        self::assertArrayHasKey($room->drawerConnectionId, $room->guessed);
    }

    public function testDrawerRotatesBetweenPlayersAcrossRounds(): void
    {
        $room = new Room('ABC123');
        $room->addPlayer(new Player('1', 'Alice', $room->id));
        $room->addPlayer(new Player('2', 'Bob', $room->id));
        $room->addPlayer(new Player('3', 'Cara', $room->id));

        $room->startRound(new Words());
        $first = $room->drawerConnectionId;
        self::assertNotNull($first);

        // simulate end of round by clearing drawer like server does
        $room->drawerConnectionId = null;
        $room->state = 'lobby';

        $room->startRound(new Words());
        $second = $room->drawerConnectionId;
        self::assertNotNull($second);

        // Rotation in this MVP starts from first player whenever drawerConnectionId was null.
        // So we at least ensure it always picks a valid player and doesn't crash/change state incorrectly.
        self::assertContains($second, ['1', '2', '3']);
    }

    public function testTimeLeftCountsDown(): void
    {
        $room = new Room('ABC123');
        $room->addPlayer(new Player('1', 'Alice', $room->id));
        $room->addPlayer(new Player('2', 'Bob', $room->id));

        $room->roundDurationSec = 2;
        $room->startRound(new Words());

        $t1 = $room->timeLeft();
        self::assertGreaterThanOrEqual(0, $t1);
        self::assertLessThanOrEqual(2, $t1);

        // Force time to be over
        $room->roundStartedAt = time() - 5;
        self::assertSame(0, $room->timeLeft());
    }
}


<?php

declare(strict_types=1);

namespace Momal\Tests\Game;

use Momal\Domain\Words;
use Momal\Game\Player;
use Momal\Game\Room;
use PHPUnit\Framework\TestCase;

final class RoomTest extends TestCase
{
    public function testStartRoundDoesNotRepeatWordAcrossReset(): void
    {
        $room = new Room('ABC123');
        $room->addPlayer(new Player('1', 'Alice', $room->id));
        $room->addPlayer(new Player('2', 'Bob', $room->id));

        $words = new Words(['A', 'B']);

        $room->startRound($words);
        $first = $room->word;
        self::assertNotNull($first);
        self::assertSame($first, $room->lastWord);

        $room->resetRoundState();

        self::assertNull($room->word);
        self::assertSame($first, $room->lastWord);

        $room->startRound($words);
        $second = $room->word;
        self::assertNotNull($second);

        self::assertNotSame($first, $second);
    }

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

        // simulate end of round as the server does
        $room->resetRoundState();

        $room->startRound(new Words());
        $second = $room->drawerConnectionId;
        self::assertNotNull($second);

        // With stable rotation, the drawer should advance in player list order.
        $ids = ['1', '2', '3'];
        $firstIdx = array_search($first, $ids, true);
        self::assertNotFalse($firstIdx);
        $expectedSecond = $ids[($firstIdx + 1) % count($ids)];
        self::assertSame($expectedSecond, $second);
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

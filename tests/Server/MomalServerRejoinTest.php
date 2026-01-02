<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerRejoinTest extends TestCase
{
    public function testJoinTwiceUpdatesNameInSameRoom(): void
    {
        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $server->onOpen($c1);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice2', 'roomId' => 'ABC123']));

        $snap = $this->findLastJsonByType($c1, 'room:snapshot');
        self::assertNotNull($snap);

        $players = (array)($snap['players'] ?? []);
        self::assertCount(1, $players);
        self::assertSame('Alice2', (string)($players[0]['name'] ?? ''));
    }

    public function testJoinTwiceMovesPlayerToNewRoomAndCleansUpOldRoom(): void
    {
        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $server->onOpen($c1);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));

        // switch rooms
        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ZZZ999']));

        $joined = $this->findLastJsonByType($c1, 'joined');
        self::assertNotNull($joined);
        self::assertSame('ZZZ999', (string)($joined['roomId'] ?? ''));

        // another player joins the old room => should become host (old room was cleaned up)
        $c2 = new FakeConnection(2);
        $server->onOpen($c2);
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));

        $joined2 = $this->findLastJsonByType($c2, 'joined');
        self::assertNotNull($joined2);
        self::assertTrue((bool)($joined2['isHost'] ?? false));
    }

    private function tmpHighscoreFile(): string
    {
        $dir = sys_get_temp_dir() . '/momal-tests';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        return $dir . '/highscore-' . uniqid('', true) . '.json';
    }

    /** @param array<string,mixed> $data */
    private function json(array $data): string
    {
        $encoded = json_encode($data);
        self::assertIsString($encoded);

        return $encoded;
    }

    /** @return array<string,mixed>|null */
    private function findLastJsonByType(FakeConnection $conn, string $type): ?array
    {
        $found = null;
        foreach ($conn->sent as $raw) {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                continue;
            }
            if (($decoded['type'] ?? null) === $type) {
                $found = $decoded;
            }
        }

        return $found;
    }
}

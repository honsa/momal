<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerRateLimitTest extends TestCase
{
    public function testChatIsRateLimitedPerConnection(): void
    {
        $server = new MomalServer(new Words(['A']), new HighscoreStore($this->tmpHighscoreFile()));

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));

        // send many messages quickly
        for ($i = 0; $i < 5; $i++) {
            $server->onMessage($c1, $this->json(['type' => 'chat', 'text' => 'spam ' . $i]));
        }

        // Bob should receive at most 1 chat message from Alice in this burst.
        $received = $this->countByType($c2, 'chat:new');

        // there are also 2 system join lines; ensure we only count non-system if present
        $nonSystem = 0;
        foreach ($c2->sent as $raw) {
            $d = json_decode($raw, true);
            if (!is_array($d) || ($d['type'] ?? null) !== 'chat:new') {
                continue;
            }
            if (($d['name'] ?? '') !== 'System') {
                $nonSystem++;
            }
        }

        self::assertGreaterThanOrEqual(2, $received);
        self::assertSame(1, $nonSystem);
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

    private function countByType(FakeConnection $conn, string $type): int
    {
        $n = 0;
        foreach ($conn->sent as $raw) {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                continue;
            }
            if (($decoded['type'] ?? null) === $type) {
                $n++;
            }
        }

        return $n;
    }
}

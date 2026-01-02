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

        // Count non-system chat messages from Alice.
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

        // At least one message should pass, but the burst should be limited.
        self::assertGreaterThanOrEqual(1, $nonSystem);
        self::assertLessThanOrEqual(1, $nonSystem);
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
}

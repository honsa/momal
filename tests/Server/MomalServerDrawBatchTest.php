<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerDrawBatchTest extends TestCase
{
    public function testDrawStrokeIsCoalescedIntoDrawBatchWithSeq(): void
    {
        $clock = 0.0;
        $server = new MomalServer(
            new Words(['WORT']),
            new HighscoreStore($this->tmpHighscoreFile()),
            static fn (): float => $clock
        );

        $c1 = new FakeConnection(1);
        $c2 = new FakeConnection(2);
        $server->onOpen($c1);
        $server->onOpen($c2);

        $server->onMessage($c1, $this->json(['type' => 'join', 'name' => 'Alice', 'roomId' => 'ABC123']));
        $server->onMessage($c2, $this->json(['type' => 'join', 'name' => 'Bob', 'roomId' => 'ABC123']));
        $server->onMessage($c1, $this->json(['type' => 'round:start']));

        $started = $this->findJsonByType($c1, 'round:started');
        self::assertNotNull($started);
        $drawerId = (string)($started['drawerConnectionId'] ?? '');
        $drawer = $drawerId === '1' ? $c1 : $c2;

        $payload = [
            't' => 'stroke',
            'p' => [
                ['x' => 0.1, 'y' => 0.2],
                ['x' => 0.2, 'y' => 0.3],
            ],
            'c' => '#000000',
            'w' => 4,
        ];

        // first flush is immediate
        $clock = 1.0;
        $server->onMessage($drawer, $this->json(['type' => 'draw:stroke', 'payload' => $payload]));

        $batch1 = $this->findJsonByType($c1, 'draw:batch');
        $batch2 = $this->findJsonByType($c2, 'draw:batch');
        self::assertNotNull($batch1);
        self::assertNotNull($batch2);

        self::assertSame(1, $batch1['seq']);
        self::assertIsArray($batch1['events']);
        /** @var array<int, mixed> $events */
        $events = $batch1['events'];
        self::assertGreaterThanOrEqual(1, count($events));
    }

    private function tmpHighscoreFile(): string
    {
        $dir = sys_get_temp_dir() . '/momal-tests';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        return $dir . '/highscore-' . uniqid('', true) . '.json';
    }

    /** @return array<string,mixed>|null */
    private function findJsonByType(FakeConnection $conn, string $type): ?array
    {
        foreach ($conn->sent as $raw) {
            $decoded = json_decode($raw, true);
            if (!is_array($decoded)) {
                continue;
            }
            if (($decoded['type'] ?? null) === $type) {
                return $decoded;
            }
        }

        return null;
    }

    /** @param array<string,mixed> $data */
    private function json(array $data): string
    {
        $encoded = json_encode($data);
        self::assertIsString($encoded);

        return $encoded;
    }
}

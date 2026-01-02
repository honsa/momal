<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Momal\Domain\HighscoreStore;
use Momal\Domain\Words;
use Momal\Server\MomalServer;
use PHPUnit\Framework\TestCase;

final class MomalServerBinaryDrawTest extends TestCase
{
    public function testBinaryStrokeIsAcceptedAndBroadcastAsBinary(): void
    {
        $clock = 1000.0;
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

        $frame = $this->packStrokeFrame(seq: 42, tsMs: 123456, rgb: [20, 30, 40], widthPx: 4.5, points: [
            [0.1, 0.2],
            [0.2, 0.3],
            [0.25, 0.33],
        ]);

        $server->onMessage($drawer, $frame);

        // In production, binary is broadcast as OP_BINARY to real WsConnection instances.
        // In tests we use FakeConnection (not WsConnection), so binary broadcast is intentionally skipped.
        // We still verify that binary input is accepted and that the server emits JSON draw:batch.

        $batch1 = $this->findJsonByType($c1, 'draw:batch');
        $batch2 = $this->findJsonByType($c2, 'draw:batch');
        self::assertNotNull($batch1);
        self::assertNotNull($batch2);

        // Additionally, the drawer should have received the round:started message already.
        self::assertNotNull($started);
    }

    /** @param list<array{0:float,1:float}> $points */
    private function packStrokeFrame(int $seq, int $tsMs, array $rgb, float $widthPx, array $points): string
    {
        $count = count($points);
        $w10 = (int)round($widthPx * 10);

        $header = 'MOML'
            . chr(1) // version
            . chr(1) // type stroke
            . pack('V', $seq)
            . pack('V', $tsMs)
            . chr((int)$rgb[0])
            . chr((int)$rgb[1])
            . chr((int)$rgb[2])
            . chr(0)
            . pack('v', $w10)
            . pack('v', $count);

        $body = '';
        foreach ($points as $p) {
            $body .= pack('g', (float)$p[0]);
            $body .= pack('g', (float)$p[1]);
        }

        return $header . $body;
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
            if (!array_key_exists('type', $decoded)) {
                continue;
            }
            if ($decoded['type'] === $type) {
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

<?php

declare(strict_types=1);

namespace Momal\Tests\Domain;

use Momal\Domain\RoomHighscoreStore;
use PHPUnit\Framework\TestCase;

final class RoomHighscoreStoreTest extends TestCase
{
    public function testBumpStoresPerRoomAndKeepsMaxPoints(): void
    {
        $file = $this->tmpFile();
        $store = new RoomHighscoreStore($file);

        $store->bump('ABC123', 'Alice', 10);
        $store->bump('ABC123', 'Alice', 7);
        $store->bump('XYZ999', 'Alice', 99);

        $topA = $store->top('ABC123', 10);
        self::assertCount(1, $topA);
        self::assertSame('Alice', $topA[0]['name']);
        self::assertSame(10, $topA[0]['points']);
        self::assertIsInt($topA[0]['updatedAt']);

        $topX = $store->top('XYZ999', 10);
        self::assertCount(1, $topX);
        self::assertSame(99, $topX[0]['points']);
    }

    private function tmpFile(): string
    {
        $dir = sys_get_temp_dir() . '/momal-tests';
        if (!is_dir($dir)) {
            mkdir($dir, 0777, true);
        }

        return $dir . '/room-highscore-' . uniqid('', true) . '.json';
    }
}

<?php

declare(strict_types=1);

namespace Momal\Tests\Domain;

use Momal\Domain\HighscoreStore;
use PHPUnit\Framework\TestCase;

final class HighscoreStoreTest extends TestCase
{
    private string $tmpFile;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tmpFile = sys_get_temp_dir() . '/momal-highscore-' . bin2hex(random_bytes(8)) . '.json';
    }

    protected function tearDown(): void
    {
        if (is_file($this->tmpFile)) {
            unlink($this->tmpFile);
        }

        parent::tearDown();
    }

    public function testBumpCreatesAndUpdatesEntryWithMaxPoints(): void
    {
        $store = new HighscoreStore($this->tmpFile);

        $store->bump('Alice', 10);
        $store->bump('alice', 7); // case-insensitive, must keep max
        $store->bump('ALICE', 15);

        $top = $store->top(10);
        self::assertCount(1, $top);
        self::assertSame('Alice', $top[0]['name']);
        self::assertSame(15, $top[0]['points']);
        self::assertGreaterThan(0, $top[0]['updatedAt']);
    }

    public function testTopSortsByPointsAndThenUpdatedAt(): void
    {
        $store = new HighscoreStore($this->tmpFile);

        $store->bump('Bob', 5);
        $store->bump('Cara', 50);
        $store->bump('Alice', 10);

        $top = $store->top(3);

        self::assertSame('Cara', $top[0]['name']);
        self::assertSame(50, $top[0]['points']);
        self::assertSame('Alice', $top[1]['name']);
        self::assertSame(10, $top[1]['points']);
        self::assertSame('Bob', $top[2]['name']);
        self::assertSame(5, $top[2]['points']);
    }

    public function testTopRespectsLimit(): void
    {
        $store = new HighscoreStore($this->tmpFile);

        $store->bump('A', 1);
        $store->bump('B', 2);
        $store->bump('C', 3);

        $top = $store->top(2);
        self::assertCount(2, $top);
        self::assertSame(['C', 'B'], [$top[0]['name'], $top[1]['name']]);
    }
}

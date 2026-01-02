<?php

declare(strict_types=1);

namespace Momal\Tests\Domain;

use Momal\Domain\Words;
use PHPUnit\Framework\TestCase;

final class WordsTest extends TestCase
{
    public function testDefaultWordsAreNotEmpty(): void
    {
        $words = new Words();
        $seen = [];

        // sample a few times to reduce flakiness
        for ($i = 0; $i < 20; $i++) {
            $w = $words->randomWord();
            self::assertNotSame('', trim($w));
            $seen[$w] = true;
        }

        self::assertGreaterThan(1, count($seen));
    }

    public function testProvidedListIsUsed(): void
    {
        $words = new Words(['A']);

        for ($i = 0; $i < 10; $i++) {
            self::assertSame('A', $words->randomWord());
        }
    }

    public function testEmptyListStillReturnsSafeDefault(): void
    {
        // This exercises the internal safety net in randomWord().
        $words = new Words([]);
        self::assertNotSame('', $words->randomWord());
    }
}

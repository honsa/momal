<?php

declare(strict_types=1);

namespace Momal\Tests\Domain;

use Momal\Domain\Words;
use PHPUnit\Framework\TestCase;

final class WordsNoRepeatTest extends TestCase
{
    public function testRandomWordDoesNotRepeatWhenExcludeProvided(): void
    {
        $words = new Words(['A', 'B']);

        $prev = 'A';
        for ($i = 0; $i < 50; $i++) {
            $w = $words->randomWord($prev);
            self::assertNotSame($prev, $w);
            $prev = $w;
        }
    }

    public function testRandomWordAllowsRepeatWhenOnlyOneWordExists(): void
    {
        $words = new Words(['A']);

        self::assertSame('A', $words->randomWord());
        self::assertSame('A', $words->randomWord('A'));
    }
}

<?php

declare(strict_types=1);

namespace Momal\Game;

final class Player
{
    public int $score = 0;

    public readonly string $name;
    public readonly string $roomId;

    public const NAME_MIN_LEN = 1;
    public const NAME_MAX_LEN = 20;

    public function __construct(
        public readonly string $connectionId,
        string $name,
        string $roomId
    ) {
        $this->name = self::sanitizeName($name);
        $this->roomId = $roomId;
    }

    public function withName(string $name): self
    {
        $p = new self($this->connectionId, $name, $this->roomId);
        $p->score = $this->score;

        return $p;
    }

    public static function sanitizeName(string $name): string
    {
        // Normalize whitespace
        $name = \trim($name);
        $name = (string)(\preg_replace('/\s+/', ' ', $name) ?? '');

        // Remove control characters (incl. newlines, tabs after normalization, etc.)
        $name = (string)(\preg_replace('/[\x00-\x1F\x7F]/u', '', $name) ?? '');

        // Keep a reasonable length
        $name = \mb_substr($name, 0, self::NAME_MAX_LEN);

        return $name;
    }
}

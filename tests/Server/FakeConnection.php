<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Ratchet\ConnectionInterface;

/**
 * Minimal test double for Ratchet connections.
 * Collects all outgoing messages via ->send().
 */
final class FakeConnection implements ConnectionInterface
{
    /** @var list<string> */
    public array $sent = [];

    /** @var list<string> */
    public array $sentBinary = [];

    public function __construct(
        public int $resourceId,
    ) {
    }

    public function send($data)
    {
        $s = (string)$data;

        // Heuristic: binary draw frames start with "MOML".
        // Store separately so JSON helpers don't choke.
        if (str_starts_with($s, 'MOML')) {
            $this->sentBinary[] = $s;
        } else {
            $this->sent[] = $s;
        }

        return $this;
    }

    public function close(): void
    {
        // no-op
    }
}

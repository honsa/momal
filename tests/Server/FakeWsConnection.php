<?php

declare(strict_types=1);

namespace Momal\Tests\Server;

use Ratchet\ConnectionInterface;
use Ratchet\RFC6455\Messaging\Frame;
use Ratchet\WebSocket\WsConnection;

/**
 * Testdouble for WsConnection that captures outgoing messages.
 *
 * We only need the fact that MomalServer checks for instanceof WsConnection and then calls ->send().
 * For our integration test, it's enough to record Frame objects and their opcode.
 */
final class FakeWsConnection extends WsConnection
{
    /** @var list<Frame> */
    public array $sentFrames = [];

    /** @var list<string> */
    public array $sentJson = [];

    public function __construct(int $resourceId)
    {
        $fake = new class ($resourceId) implements ConnectionInterface {
            public function __construct(public int $resourceId)
            {
            }

            public function send($data)
            {
                return $this;
            }

            public function close(): void
            {
            }
        };

        parent::__construct($fake);

        // Ensure MomalServer reads stable ids (it checks method_exists first).
        $this->resourceId = $resourceId;
    }

    /**
     * Ratchet's ConnectionInterface users typically rely on a public $resourceId property.
     * @var int
     */
    public int $resourceId;

    public function send($msg)
    {
        /** @var mixed $msg */
        if ($msg instanceof Frame) {
            $this->sentFrames[] = $msg;

            return $this;
        }

        $this->sentJson[] = (string)$msg;

        return $this;
    }
}

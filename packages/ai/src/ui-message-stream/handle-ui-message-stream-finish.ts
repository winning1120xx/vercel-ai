import {
  createStreamingUIMessageState,
  processUIMessageStream,
  StreamingUIMessageState,
} from '../ui/process-ui-message-stream';
import { UIMessage } from '../ui/ui-messages';
import { ErrorHandler } from '../util/error-handler';
import { InferUIMessageChunk, UIMessageChunk } from './ui-message-chunks';

export function handleUIMessageStreamFinish<UI_MESSAGE extends UIMessage>({
  messageId,
  originalMessages = [],
  onFinish,
  onError,
  stream,
}: {
  stream: ReadableStream<InferUIMessageChunk<UI_MESSAGE>>;

  messageId: string;

  /**
   * The original messages.
   */
  originalMessages?: UI_MESSAGE[];

  onError: ErrorHandler;

  onFinish?: (options: {
    /**
     * The updates list of UI messages.
     */
    messages: UI_MESSAGE[];

    /**
     * Indicates whether the response message is a continuation of the last original message,
     * or if a new message was created.
     */
    isContinuation: boolean;

    /**
     * The message that was sent to the client as a response
     * (including the original message if it was extended).
     */
    responseMessage: UI_MESSAGE;
  }) => void;
}): ReadableStream<InferUIMessageChunk<UI_MESSAGE>> {
  if (onFinish == null) {
    return stream;
  }

  const lastMessage = originalMessages?.[originalMessages.length - 1];

  const state = createStreamingUIMessageState<UI_MESSAGE>({
    lastMessage: lastMessage
      ? (structuredClone(lastMessage) as UI_MESSAGE)
      : undefined,
    messageId, // will be overridden by the stream
  });

  const runUpdateMessageJob = async (
    job: (options: {
      state: StreamingUIMessageState<UI_MESSAGE>;
      write: () => void;
    }) => Promise<void>,
  ) => {
    await job({ state, write: () => {} });
  };

  return processUIMessageStream<UI_MESSAGE>({
    stream: stream.pipeThrough(
      new TransformStream<
        InferUIMessageChunk<UI_MESSAGE>,
        InferUIMessageChunk<UI_MESSAGE>
      >({
        transform(chunk, controller) {
          // when there is no messageId in the start chunk,
          // but the user checked for persistence,
          // inject the messageId into the chunk
          if (chunk.type === 'start') {
            const startChunk = chunk as UIMessageChunk & { type: 'start' };
            if (startChunk.messageId == null) {
              startChunk.messageId = messageId;
            }
          }

          controller.enqueue(chunk);
        },
      }),
    ),
    runUpdateMessageJob,
    onError,
  }).pipeThrough(
    new TransformStream<
      InferUIMessageChunk<UI_MESSAGE>,
      InferUIMessageChunk<UI_MESSAGE>
    >({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },

      flush() {
        const isContinuation = state.message.id === lastMessage?.id;
        onFinish({
          isContinuation,
          responseMessage: state.message as UI_MESSAGE,
          messages: [
            ...(isContinuation
              ? originalMessages.slice(0, -1)
              : originalMessages),
            state.message,
          ] as UI_MESSAGE[],
        });
      },
    }),
  );
}

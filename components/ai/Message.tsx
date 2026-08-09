type MessageProps = {
  role: "user" | "assistant";
  content: string;
};

export default function Message({
  role,
  content,
}: MessageProps) {
  const isUser = role === "user";

  return (
    <div
      className={`flex ${
        isUser
          ? "justify-end"
          : "justify-start"
      }`}
    >
      <div
        className={`max-w-2xl rounded-2xl px-4 py-3 ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-slate-800 text-slate-200"
        }`}
      >
        {content}
      </div>
    </div>
  );
}
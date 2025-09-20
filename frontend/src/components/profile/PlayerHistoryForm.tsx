import { type FormEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  SelectLabel,
  SelectGroup,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Progress } from "@/components/ui/progress";
import type { PlayerHistoryFormProps } from "@/types";

export function PlayerHistoryForm({
  onSearch,
  onUpdate,
  isLoading,
  progress,
  cooldown,
  formData,
  onFormChange,
  isUpdating,
  canUpdate,
}: PlayerHistoryFormProps) {
  const [errors, setErrors] = useState({
    region: false,
    username: false,
    tag: false,
  });

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();

    const newErrors = {
      region: !formData.region,
      username: !formData.username,
      tag: !formData.tag,
    };

    setErrors(newErrors);

    const isInvalid = Object.values(newErrors).some((error) => error);

    if (isInvalid) {
      toast.error("Validation Error", {
        description: "Please fill out all fields before submitting.",
      });
      return;
    }
    if (canUpdate) {
      onUpdate();
    } else {
      onSearch(formData);
    }
  };

  const handleInputChange = (
    field: keyof PlayerHistoryFormProps["formData"],
    value: string
  ) => {
    // 1. Propagate the change to the parent component
    onFormChange(field, value);

    // 2. Clear the error for this field if it has a value
    if (value) {
      setErrors((prevErrors) => ({ ...prevErrors, [field]: false }));
    }
  };

  const getButtonText = () => {
    if (cooldown > 0) return `Cooldown (${cooldown}s)`;
    if (isLoading) return "Fetching...";
    // If the App indicates we can update the current URL/form, prefer Update
    return canUpdate ? "Update" : "Fetch History";
  };

  return (
    <div className="w-full">
      <form onSubmit={handleSubmit} className="flex w-full items-end gap-2">
        <div className="flex-grow">
          <Label htmlFor="username" className="sr-only">
            Riot ID
          </Label>
          <div className="flex rounded-md shadow-sm">
            <Select
              value={formData.region}
              onValueChange={(value) => handleInputChange("region", value)} // Use new handler
              disabled={isLoading}
            >
              <SelectTrigger
                id="region"
                className={`w-28 rounded-r-none focus:ring-0 ${
                  errors.region
                    ? "border-destructive ring-1 ring-destructive"
                    : ""
                }`} // Apply conditional class
                aria-label="Select region"
              >
                <SelectValue placeholder="Region" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectLabel>Region</SelectLabel>
                  <SelectItem value="na">NA</SelectItem>
                  <SelectItem value="euw">EUW</SelectItem>
                  <SelectItem value="eune">EUNE</SelectItem>
                  <SelectItem value="kr">KR</SelectItem>
                  <SelectItem value="br">BR</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <div className="relative flex-grow">
              <Input
                id="username"
                placeholder="Riot ID"
                value={formData.username}
                onChange={(e) => handleInputChange("username", e.target.value)} // Use new handler
                className={`rounded-l-none border-l-0 pl-3 pr-16 focus:ring-0 ${
                  errors.username
                    ? "border-destructive ring-1 ring-destructive"
                    : ""
                }`} // Apply conditional class
                disabled={isLoading}
              />
              <div className="absolute inset-y-0 right-0 flex items-center">
                <span className="text-muted-foreground p-1">#</span>
                <Input
                  id="tag"
                  placeholder="Tag"
                  className={`w-16 border-0 bg-transparent p-0 text-center focus:ring-0 ${
                    errors.tag
                      ? "border-destructive ring-1 ring-destructive"
                      : ""
                  }`} // Apply conditional class
                  value={formData.tag}
                  onChange={(e) => handleInputChange("tag", e.target.value)} // Use new handler
                  disabled={isLoading}
                />
              </div>
            </div>
          </div>
        </div>
        <div className="flex-shrink-0">
          <Button type="submit" disabled={isLoading || cooldown > 0}>
            {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {getButtonText()}
          </Button>
        </div>
      </form>
      {isUpdating && (
        <div className="mt-2">
          <Progress value={progress} />
        </div>
      )}
    </div>
  );
}

export default PlayerHistoryForm;
